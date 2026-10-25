import { z } from "zod";
import { rows, one, run, uid, type Database } from "./database.ts";
import type {
  Identity,
  Course,
  Member,
  Activity,
  Rule,
  RuleProgress,
  Challenge,
  Message,
  Award,
  Condition,
} from "./types.ts";
import {
  defaultRules,
  evaluateCondition,
  evaluateRule,
  summarize,
} from "./gamification.ts";
import { todayInZone, weekStart, addDays } from "./dates.ts";
import {
  validateSubscription,
  normalizeApplicationUrl,
  type SendResult,
} from "./push.ts";
export interface ServerConfig {
  courseId?: string;
  bootstrapAdminEmail?: string;
  now?: () => Date;
  vapidPublicKey?: string;
  vapidPrivateKey?: string;
  vapidSubject?: string;
  siteUrl?: string;
  emailApiKey?: string;
  emailFrom?: string;
  emailEnabled?: boolean;
  invitationSender?: (payload: {
    to: string;
    nickname: string;
    courseName: string;
    siteUrl: string;
    idempotencyKey: string;
  }) => Promise<SendResult>;
}
class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
function fail(status: number, message: string): never {
  throw new HttpError(status, message);
}
const str = (v: unknown, max = 2000) =>
  z
    .string()
    .trim()
    .max(max)
    .parse(v ?? "");
const required = (v: unknown, max = 100) =>
  z.string().trim().min(1).max(max).parse(v);
const date = (v: unknown) => {
  const s = z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .parse(v),
    parsed = new Date(s + "T12:00:00Z");
  if (
    !Number.isFinite(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== s
  )
    fail(400, "Neplatný dátum.");
  return s;
};
const bool = (v: unknown) => z.boolean().parse(v);
const numeric = (v: unknown, max: number, allowZero = false) =>
  v === null || v === undefined || v === ""
    ? null
    : (allowZero
        ? z.number().finite().min(0).max(max)
        : z.number().finite().positive().max(max)
      ).parse(v);
const conditionSchema: z.ZodType<Condition> = z.lazy(() =>
  z.union([
    z.object({
      kind: z.literal("days"),
      count: z.number().int().min(1).max(365),
      groups: z
        .array(z.enum(["foot", "exercise", "other"]))
        .min(1)
        .max(3)
        .optional(),
      minMinutes: z.number().min(1).max(1440).optional(),
    }),
    z.object({
      kind: z.literal("activities"),
      count: z.number().int().min(1).max(500),
      groups: z
        .array(z.enum(["foot", "exercise", "other"]))
        .min(1)
        .max(3)
        .optional(),
      minMinutes: z.number().min(1).max(1440).optional(),
    }),
    z.object({ kind: z.literal("manual"), count: z.literal(1) }),
    z.object({
      kind: z.literal("combination"),
      conditions: z.array(conditionSchema).min(1).max(5),
    }),
  ]),
);
/** Bounded typed templates, not an unbounded rules language. */
function parseCondition(value: unknown): Condition {
  let nodes = 0;
  const inspect = (item: unknown, depth: number) => {
    if (depth > 3 || ++nodes > 20)
      fail(
        400,
        "Podmienka je príliš zložitá. Použi najviac tri úrovne a dvadsať častí.",
      );
    if (
      item &&
      typeof item === "object" &&
      "conditions" in item &&
      Array.isArray(item.conditions)
    )
      for (const child of item.conditions) inspect(child, depth + 1);
  };
  inspect(value, 0);
  return conditionSchema.parse(value);
}
const hasManual = (condition: Condition): boolean =>
  condition.kind === "manual" ||
  (condition.kind === "combination" && condition.conditions.some(hasManual));
const emailConfigured = (cfg: ServerConfig) =>
  !!(cfg.emailEnabled || (cfg.emailApiKey && cfg.emailFrom));
const json = (v: unknown, status = 200) =>
  Response.json(v, {
    status,
    headers: {
      "Cache-Control": "private, no-store",
      Vary: "Cookie",
      "X-Content-Type-Options": "nosniff",
    },
  });
const member = (r: any, privateFields = false): Member => ({
  id: r.id,
  courseId: r.course_id,
  userId: privateFields ? r.user_id : null,
  ...(privateFields ? { email: r.email } : {}),
  nickname: r.nickname,
  role: r.role,
  active: !!r.active,
  animations: !!r.animations,
  joinedAt: r.joined_at,
});
const typeRow = (r: any) => ({
  id: r.id,
  name: r.name,
  group: r.group_name,
  hidden: !!r.hidden,
  active: !!r.active,
  challengeId: r.challenge_id,
});
const safeLink = (v: unknown) => {
  const link = str(v, 300);
  if (
    link &&
    (!link.startsWith("/") ||
      link.startsWith("//") ||
      link.includes("\\") ||
      /[\r\n]/.test(link))
  )
    fail(400, "Odkaz musí smerovať do aplikácie.");
  return link;
};
export async function bootstrap(
  db: Database,
  identity: Identity,
  config: ServerConfig,
) {
  const cid = config.courseId || "cestou-zimy";
  if (
    !config.bootstrapAdminEmail ||
    identity.email.toLowerCase() !== config.bootstrapAdminEmail.toLowerCase()
  )
    return;
  if (await one(db, "SELECT id FROM courses WHERE id=?", cid)) return;
  const now = (config.now?.() ?? new Date()).toISOString(),
    today = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Bratislava",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(now));
  const course: Course = {
    id: cid,
    name: "Cestou Zimy · testovací ročník",
    startDate: addDays(weekStart(today), -28),
    endDate: addDays(weekStart(today), 55),
    timezone: "Europe/Bratislava",
    squirrelLimit: 2,
    testMode: true,
  };
  const statements = [
    db
      .prepare("INSERT OR IGNORE INTO courses(id,data) VALUES(?,?)")
      .bind(cid, JSON.stringify(course)),
    db
      .prepare(
        "INSERT OR IGNORE INTO members(id,course_id,user_id,email,nickname,role,active,animations,joined_at) VALUES(?,?,?,?,?,?,1,1,?)",
      )
      .bind(
        uid(),
        cid,
        identity.userId,
        identity.email.toLowerCase(),
        "Organizátor",
        "admin",
        now,
      ),
  ];
  const types = [
    ["walk", "Chôdza / prechádzka", "foot"],
    ["hike", "Turistika", "foot"],
    ["run", "Beh", "foot"],
    ["exercise", "Cvičenie", "exercise"],
    ["swim", "Plávanie", "other"],
    ["bike", "Bicykel", "other"],
    ["other", "Iný šport", "other"],
  ];
  for (const [id, name, group] of types)
    statements.push(
      db
        .prepare(
          "INSERT OR IGNORE INTO activity_types(id,course_id,name,group_name,hidden,active) VALUES(?,?,?,?,0,1)",
        )
        .bind(cid + "-" + id, cid, name, group),
    );
  for (const r of defaultRules(course.startDate)) {
    r.id = cid + "-" + r.id;
    statements.push(
      db
        .prepare(
          "INSERT OR IGNORE INTO rules(id,course_id,key,version,effective_from,data) VALUES(?,?,?,?,?,?)",
        )
        .bind(r.id, cid, r.key, r.version, r.effectiveFrom, JSON.stringify(r)),
    );
  }
  for (const [key, name, description] of [
    [
      "cold",
      "Studená sprcha",
      "Dobrovoľne si vyskúšaj krátku chladnejšiu sprchu podľa vlastného komfortu. Bez merania času a bez prekonávania hraníc.",
    ],
    [
      "outside",
      "Noc vonku",
      "Dobrovoľné prespanie vonku po dohode s organizátorom a s primeranou výbavou. Bez odmeny za extrémny chlad.",
    ],
  ]) {
    const ch: Challenge = {
      id: cid + "-" + key,
      name,
      description,
      startDate: course.startDate,
      endDate: course.endDate,
      status: "draft",
      hidden: true,
      reward: "Bonusový kryštál",
      condition: { kind: "manual", count: 1 },
      typeId: cid + "-" + key,
      createdAt: now,
      publishedAt: null,
    };
    statements.push(
      db
        .prepare(
          "INSERT OR IGNORE INTO challenges(id,course_id,data,status,hidden) VALUES(?,?,?,?,1)",
        )
        .bind(ch.id, cid, JSON.stringify(ch), "draft"),
    );
    statements.push(
      db
        .prepare(
          "INSERT OR IGNORE INTO activity_types(id,course_id,name,group_name,hidden,active,challenge_id) VALUES(?,?,?,?,1,1,?)",
        )
        .bind(ch.typeId, cid, name, "task", ch.id),
    );
  }
  await db.batch(statements);
}
async function authenticate(
  db: Database,
  identity: Identity | null,
  cfg: ServerConfig,
): Promise<{ me: Member; course: Course; today: string; now: string }> {
  if (!identity) fail(401, "Najprv sa prihlás.");
  const cid = cfg.courseId || "cestou-zimy";
  await bootstrap(db, identity, cfg);
  const c = await one(db, "SELECT data FROM courses WHERE id=?", cid);
  if (!c)
    fail(409, "Aplikácia čaká na bezpečné vytvorenie prvého organizátora.");
  let r = await one(
    db,
    "SELECT * FROM members WHERE course_id=? AND user_id=?",
    cid,
    identity.userId,
  );
  if (!r) {
    r = await one(
      db,
      "SELECT * FROM members WHERE course_id=? AND email=? AND user_id IS NULL AND active=1",
      cid,
      identity.email.toLowerCase(),
    );
    if (r) {
      await run(
        db,
        "UPDATE members SET user_id=? WHERE id=? AND user_id IS NULL",
        identity.userId,
        r.id,
      );
      r = await one(
        db,
        "SELECT * FROM members WHERE course_id=? AND user_id=?",
        cid,
        identity.userId,
      );
    }
  }
  if (!r || !r.active)
    fail(
      403,
      "Do tohto kurzu zatiaľ nemáš aktívnu pozvánku. Ozvi sa organizátorovi.",
    );
  const course: Course = JSON.parse(c.data),
    now = (cfg.now?.() ?? new Date()).toISOString();
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: course.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(now));
  return { me: member(r, true), course, today, now };
}
async function getActivities(db: Database, cid: string): Promise<Activity[]> {
  const data = await rows(
    db,
    `SELECT a.*,t.name type_name,t.group_name,m.nickname FROM activities a JOIN activity_types t ON t.id=a.type_id JOIN members m ON m.id=a.member_id WHERE a.course_id=? AND t.hidden=0 AND m.active=1 ORDER BY a.date DESC,a.created_at DESC`,
    cid,
  );
  return data.map((a) => ({
    id: a.id,
    courseId: a.course_id,
    memberId: a.member_id,
    typeId: a.type_id,
    date: a.date,
    minutes: a.minutes,
    distance: a.distance,
    note: a.note,
    createdAt: a.created_at,
    updatedAt: a.updated_at,
    group: a.group_name,
    typeName: a.type_name,
    nickname: a.nickname,
  }));
}
async function getRules(db: Database, cid: string): Promise<Rule[]> {
  return (
    await rows(
      db,
      "SELECT data FROM rules WHERE course_id=? ORDER BY version",
      cid,
    )
  ).map((r) => JSON.parse(r.data));
}
function progressFor(
  rules: Rule[],
  acts: Activity[],
  course: Course,
  today: string,
  manualDates: string[],
): RuleProgress[] {
  const out: RuleProgress[] = [];
  for (const key of [...new Set(rules.map((r) => r.key))]) {
    const versions = rules
      .filter((r) => r.key === key)
      .sort((a, b) => a.version - b.version);
    for (const rule of versions) {
      for (const p of evaluateRule(rule, acts, course, today, 0)) {
        const manual = manualDates.filter(
          (d) =>
            d >= p.periodStart &&
            d <= p.periodEnd &&
            d >= course.startDate &&
            d <= today,
        ).length;
        if (hasManual(rule.condition))
          p.progress = evaluateCondition(
            rule.condition,
            acts.filter(
              (a) =>
                a.date >= p.periodStart &&
                a.date <= p.periodEnd &&
                a.date >= course.startDate &&
                a.date <= today,
            ),
            manual,
          );
        const reference =
          p.periodStart < course.startDate ? course.startDate : p.periodStart;
        const selected = versions
          .filter((v) => v.effectiveFrom <= reference)
          .at(-1);
        if (selected?.id === rule.id && selected.active) out.push(p);
      }
    }
  }
  return out;
}
async function recalculate(
  db: Database,
  course: Course,
  memberId: string,
  today: string,
  now: string,
): Promise<RuleProgress[]> {
  const [rules, all, manual, old] = await Promise.all([
    getRules(db, course.id),
    getActivities(db, course.id),
    rows<{ date: string }>(
      db,
      "SELECT date FROM completions WHERE course_id=? AND member_id=? AND challenge_id=?",
      course.id,
      memberId,
      "gear",
    ),
    rows(
      db,
      "SELECT * FROM awards WHERE course_id=? AND member_id=?",
      course.id,
      memberId,
    ),
  ]);
  const progress = progressFor(
    rules,
    all.filter((a) => a.memberId === memberId),
    course,
    today,
    manual.map((c) => c.date),
  );
  const desired = progress.filter((p) => p.progress.complete),
    statements = [];
  for (const a of old) {
    if (
      !desired.some(
        (p) => p.rule.key === a.rule_key && p.periodStart === a.period_start,
      )
    )
      statements.push(db.prepare("DELETE FROM awards WHERE id=?").bind(a.id));
  }
  for (const p of desired) {
    const before = old.find(
      (a) => a.rule_key === p.rule.key && a.period_start === p.periodStart,
    );
    if (!before)
      statements.push(
        db
          .prepare(
            "INSERT OR IGNORE INTO awards(id,course_id,member_id,rule_key,period_start,period_end,rule_version,earned_at,snapshot) VALUES(?,?,?,?,?,?,?,?,?)",
          )
          .bind(
            uid(),
            course.id,
            memberId,
            p.rule.key,
            p.periodStart,
            p.periodEnd,
            p.rule.version,
            now,
            JSON.stringify(p.rule),
          ),
      );
    else if (before.rule_version !== p.rule.version)
      statements.push(
        db
          .prepare("UPDATE awards SET rule_version=?,snapshot=? WHERE id=?")
          .bind(p.rule.version, JSON.stringify(p.rule), before.id),
      );
  }
  if (statements.length) await db.batch(statements);
  const awards = await getAwards(db, course.id, memberId);
  return progress.map((p) => ({
    ...p,
    award: awards.find(
      (a) => a.ruleKey === p.rule.key && a.periodStart === p.periodStart,
    ),
  }));
}
async function getAwards(
  db: Database,
  cid: string,
  mid?: string,
): Promise<Award[]> {
  return (
    await rows(
      db,
      "SELECT a.* FROM awards a JOIN members m ON m.id=a.member_id WHERE a.course_id=? AND m.active=1" +
        (mid ? " AND a.member_id=?" : ""),
      ...(mid ? [cid, mid] : [cid]),
    )
  ).map((a) => {
    const snapshot = JSON.parse(a.snapshot);
    return {
      id: a.id,
      memberId: a.member_id,
      ruleKey: a.rule_key,
      periodStart: a.period_start,
      periodEnd: a.period_end,
      ruleVersion: a.rule_version,
      name: snapshot.name,
      gem: snapshot.gem,
      earnedAt: a.earned_at,
      snapshot,
    };
  });
}
async function log(
  db: Database,
  cid: string,
  mid: string,
  action: string,
  details: unknown,
  now: string,
) {
  await run(
    db,
    "INSERT INTO audit(id,course_id,member_id,action,details,created_at) VALUES(?,?,?,?,?,?)",
    uid(),
    cid,
    mid,
    action,
    JSON.stringify(details),
    now,
  );
}
async function ownedActivity(
  db: Database,
  id: unknown,
  me: Member,
  own = false,
) {
  const a = await one(
    db,
    "SELECT a.* FROM activities a JOIN activity_types t ON t.id=a.type_id WHERE a.id=? AND a.course_id=? AND t.hidden=0",
    required(id),
    me.courseId,
  );
  if (!a) fail(404, "Záznam sa nenašiel.");
  if (own && a.member_id !== me.id)
    fail(403, "Môžeš meniť iba vlastné aktivity.");
  return a;
}
function validatePeriod(start: string, end: string, course: Course) {
  if (start > end || start < course.startDate || end > course.endDate)
    fail(
      400,
      "Obdobie musí byť v rozsahu prípravy a koniec nesmie byť pred začiatkom.",
    );
}
export async function handleRequest(
  request: Request,
  identity: Identity | null,
  db: Database,
  cfg: ServerConfig = {},
): Promise<Response> {
  try {
    const path = new URL(request.url).pathname;
    if (path === "/api/health") return json({ ok: true });
    if (path === "/api/identity")
      return json({
        identity,
        needsSetup: !(await one(
          db,
          "SELECT id FROM courses WHERE id=?",
          cfg.courseId || "cestou-zimy",
        )),
      });
    if (!["GET", "POST"].includes(request.method))
      fail(405, "Nepodporovaná metóda.");
    if (request.method === "POST") {
      const origin = request.headers.get("origin");
      if (origin && origin !== new URL(request.url).origin)
        fail(403, "Požiadavka musí pochádzať z tejto aplikácie.");
      if (request.headers.get("sec-fetch-site") === "cross-site")
        fail(403, "Požiadavka musí pochádzať z tejto aplikácie.");
      if (!request.headers.get("content-type")?.includes("application/json"))
        fail(415, "Očakáva sa JSON.");
    }
    const { me, course, today, now } = await authenticate(db, identity, cfg);
    const cid = course.id;
    if (path === "/api/state" && request.method === "GET") {
      const [activities, types, members, rules, challengeRows, messageRows] =
        await Promise.all([
          getActivities(db, cid),
          rows(
            db,
            "SELECT * FROM activity_types WHERE course_id=? AND hidden=0",
            cid,
          ),
          rows(
            db,
            "SELECT * FROM members WHERE course_id=? AND active=1 ORDER BY nickname COLLATE NOCASE",
            cid,
          ),
          recalculate(db, course, me.id, today, now),
          rows(
            db,
            "SELECT data FROM challenges WHERE course_id=? AND hidden=0 AND status!='draft'",
            cid,
          ),
          rows(
            db,
            "SELECT m.data,m.sent_at,r.read_at FROM messages m JOIN recipients r ON r.message_id=m.id WHERE m.course_id=? AND r.member_id=? AND m.status='sent' ORDER BY m.sent_at DESC",
            cid,
            me.id,
          ),
        ]);
      const [comments, reactions, completions, awards] = await Promise.all([
        rows(
          db,
          "SELECT c.*,m.nickname FROM comments c JOIN members m ON m.id=c.member_id JOIN activities a ON a.id=c.activity_id JOIN activity_types t ON t.id=a.type_id WHERE a.course_id=? AND t.hidden=0 ORDER BY c.created_at",
          cid,
        ),
        rows(
          db,
          "SELECT r.* FROM reactions r JOIN activities a ON a.id=r.activity_id JOIN activity_types t ON t.id=a.type_id WHERE a.course_id=? AND t.hidden=0",
          cid,
        ),
        rows(
          db,
          "SELECT * FROM completions WHERE course_id=? AND member_id=?",
          cid,
          me.id,
        ),
        getAwards(db, cid),
      ]);
      for (const a of activities) {
        a.comments = comments
          .filter((c) => c.activity_id === a.id)
          .map((c) => ({
            id: c.id,
            activityId: c.activity_id,
            memberId: c.member_id,
            nickname: c.nickname,
            body: c.body,
            createdAt: c.created_at,
          }));
        a.reactions = reactions
          .filter((r) => r.activity_id === a.id)
          .map((r) => r.member_id);
      }
      const challenges = challengeRows.map((r) => {
        const ch: Challenge = JSON.parse(r.data),
          ownCompletions = completions.filter(
            (c) =>
              c.challenge_id === ch.id &&
              c.date >= ch.startDate &&
              c.date <= ch.endDate,
          );
        const progress = evaluateCondition(
          ch.condition,
          activities.filter(
            (a) =>
              a.memberId === me.id &&
              a.date >= ch.startDate &&
              a.date <= ch.endDate,
          ),
          ownCompletions.length,
        );
        return {
          ...ch,
          manualCompleted: ownCompletions.length > 0,
          completion: ownCompletions[0]
            ? { date: ownCompletions[0].date, note: ownCompletions[0].note }
            : null,
          completed: progress.complete,
          progress,
        };
      });
      const messages = messageRows.map((r) => {
        const { recipients: _, push: __, ...m } = JSON.parse(r.data);
        return { ...m, sentAt: r.sent_at, readAt: r.read_at, status: "sent" };
      });
      return json({
        course,
        me,
        members: members.map((r) => member(r)),
        types: types.map(typeRow),
        activities,
        rules,
        awards,
        challenges,
        messages,
        summary: summarize(activities),
        today,
        pushConfigured: !!(
          cfg.vapidPublicKey &&
          cfg.vapidPrivateKey &&
          cfg.vapidSubject &&
          normalizeApplicationUrl(cfg.siteUrl)
        ),
        vapidPublicKey: cfg.vapidPublicKey || null,
      });
    }
    if (path === "/api/admin" && request.method === "GET") {
      if (me.role !== "admin") fail(403, "Táto časť je iba pre organizátora.");
      const [members, types, rules, challenges, messages, audit, outbox] =
        await Promise.all([
          rows(
            db,
            "SELECT * FROM members WHERE course_id=? ORDER BY nickname",
            cid,
          ),
          rows(db, "SELECT * FROM activity_types WHERE course_id=?", cid),
          getRules(db, cid),
          rows(db, "SELECT data FROM challenges WHERE course_id=?", cid),
          rows(
            db,
            "SELECT data,status,sent_at FROM messages WHERE course_id=? ORDER BY created_at DESC",
            cid,
          ),
          rows(
            db,
            "SELECT id,member_id memberId,action,details,created_at createdAt FROM audit WHERE course_id=? ORDER BY created_at DESC LIMIT 100",
            cid,
          ),
          rows(
            db,
            "SELECT id,kind,status,attempts,last_error lastError,created_at createdAt FROM outbox WHERE course_id=? ORDER BY created_at DESC LIMIT 100",
            cid,
          ),
        ]);
      return json({
        members: members.map((r) => member(r, true)),
        types: types.map(typeRow),
        rules,
        challenges: challenges.map((r) => JSON.parse(r.data)),
        messages: messages.map((r) => ({
          ...JSON.parse(r.data),
          status: r.status,
          sentAt: r.sent_at,
        })),
        audit,
        outbox,
      });
    }
    if (path === "/api/export.csv" && request.method === "GET") {
      if (me.role !== "admin") fail(403, "Export je dostupný organizátorovi.");
      const dataset = z
        .enum([
          "activities",
          "members",
          "awards",
          "challenges",
          "completions",
          "announcements",
          "recipients",
          "comments",
          "reactions",
        ])
        .parse(
          new URL(request.url).searchParams.get("dataset") || "activities",
        );
      let header: string[];
      let records: unknown[][];
      switch (dataset) {
        case "activities": {
          // Export retained course history, including inactive members. Ordinary
          // participant feeds intentionally use a narrower visibility query.
          const list = await rows(
            db,
            "SELECT a.*,m.nickname,t.name type_name FROM activities a JOIN members m ON m.id=a.member_id AND m.course_id=a.course_id JOIN activity_types t ON t.id=a.type_id AND t.course_id=a.course_id WHERE a.course_id=? ORDER BY a.date,a.created_at,a.id",
            cid,
          );
          header = [
            "ID",
            "Účastník",
            "Dátum",
            "Typ",
            "Minúty",
            "Km",
            "Poznámka",
          ];
          records = list.map((a) => [
            a.id,
            a.nickname,
            a.date,
            a.type_name,
            a.minutes,
            a.distance,
            a.note,
          ]);
          break;
        }
        case "members": {
          const list = await rows(
            db,
            "SELECT id,nickname,email,role,active,animations,joined_at FROM members WHERE course_id=? ORDER BY nickname,id",
            cid,
          );
          header = [
            "ID",
            "Prezývka",
            "E-mail",
            "Rola",
            "Aktívne členstvo",
            "Povolené animácie",
            "Pridaný",
          ];
          records = list.map((m) => [
            m.id,
            m.nickname,
            m.email,
            m.role,
            m.active,
            m.animations,
            m.joined_at,
          ]);
          break;
        }
        case "awards": {
          const list = await rows(
            db,
            "SELECT a.*,m.nickname FROM awards a JOIN members m ON m.id=a.member_id AND m.course_id=a.course_id WHERE a.course_id=? ORDER BY a.member_id,a.period_start,a.rule_key",
            cid,
          );
          header = [
            "ID",
            "ID člena",
            "Prezývka",
            "Kľúč pravidla",
            "Názov odmeny",
            "Verzia pravidla",
            "Obdobie od",
            "Obdobie do",
            "Udelené",
            "Snapshot pravidla (JSON)",
          ];
          records = list.map((a) => [
            a.id,
            a.member_id,
            a.nickname,
            a.rule_key,
            JSON.parse(a.snapshot).name,
            a.rule_version,
            a.period_start,
            a.period_end,
            a.earned_at,
            a.snapshot,
          ]);
          break;
        }
        case "challenges": {
          const list = await rows(
            db,
            "SELECT id,data,status,hidden FROM challenges WHERE course_id=? ORDER BY id",
            cid,
          );
          header = [
            "ID",
            "Názov",
            "Opis",
            "Plnenie od",
            "Plnenie do",
            "Stav",
            "Skrytá",
            "Odmena",
            "Podmienka (JSON)",
            "ID súvisiaceho typu",
            "Vytvorená",
            "Zverejnená",
          ];
          records = list.map((r) => {
            const c: Challenge = JSON.parse(r.data);
            return [
              r.id,
              c.name,
              c.description,
              c.startDate,
              c.endDate,
              r.status,
              r.hidden,
              c.reward,
              JSON.stringify(c.condition),
              c.typeId,
              c.createdAt,
              c.publishedAt,
            ];
          });
          break;
        }
        case "completions": {
          const list = await rows(
            db,
            "SELECT c.*,m.nickname,ch.data challenge_data FROM completions c JOIN members m ON m.id=c.member_id AND m.course_id=c.course_id LEFT JOIN challenges ch ON ch.id=c.challenge_id AND ch.course_id=c.course_id WHERE c.course_id=? ORDER BY c.date,c.id",
            cid,
          );
          header = [
            "ID",
            "ID člena",
            "Prezývka",
            "ID výzvy alebo úlohy",
            "Názov úlohy",
            "Deň splnenia",
            "Poznámka",
            "Zapísané",
          ];
          records = list.map((c) => [
            c.id,
            c.member_id,
            c.nickname,
            c.challenge_id,
            c.challenge_id === "gear"
              ? "Výbava"
              : c.challenge_data
                ? JSON.parse(c.challenge_data).name
                : "",
            c.date,
            c.note,
            c.created_at,
          ]);
          break;
        }
        case "announcements": {
          const list = await rows(
            db,
            "SELECT id,data,status,created_at,sent_at FROM messages WHERE course_id=? ORDER BY created_at,id",
            cid,
          );
          header = [
            "ID",
            "Titulok",
            "Obsah",
            "Odkaz",
            "Dôležitá",
            "Pripnutá",
            "Okruh adresátov",
            "Vybraní adresáti konceptu (ID, JSON)",
            "Stav",
            "Vytvorená",
            "Odoslaná",
            "Zvolený push",
          ];
          records = list.map((r) => {
            const m: Message = JSON.parse(r.data);
            return [
              r.id,
              m.title,
              m.body,
              m.link,
              m.important ? 1 : 0,
              m.pinned ? 1 : 0,
              m.audience,
              JSON.stringify(m.recipients || []),
              r.status,
              r.created_at,
              r.sent_at,
              m.push ? 1 : 0,
            ];
          });
          break;
        }
        case "recipients": {
          const list = await rows(
            db,
            "SELECT r.*,m.nickname,msg.data message_data,msg.sent_at FROM recipients r JOIN messages msg ON msg.id=r.message_id JOIN members m ON m.id=r.member_id AND m.course_id=msg.course_id WHERE msg.course_id=? ORDER BY r.message_id,r.member_id",
            cid,
          );
          header = [
            "ID",
            "ID správy",
            "Titulok správy",
            "ID adresáta",
            "Prezývka",
            "Odoslaná",
            "Prečítaná",
          ];
          records = list.map((r) => [
            r.id,
            r.message_id,
            JSON.parse(r.message_data).title,
            r.member_id,
            r.nickname,
            r.sent_at,
            r.read_at,
          ]);
          break;
        }
        case "comments": {
          const list = await rows(
            db,
            "SELECT c.*,m.nickname FROM comments c JOIN activities a ON a.id=c.activity_id JOIN members m ON m.id=c.member_id AND m.course_id=a.course_id WHERE a.course_id=? ORDER BY c.created_at,c.id",
            cid,
          );
          header = [
            "ID",
            "ID aktivity",
            "ID autora",
            "Prezývka",
            "Komentár",
            "Vytvorený",
          ];
          records = list.map((c) => [
            c.id,
            c.activity_id,
            c.member_id,
            c.nickname,
            c.body,
            c.created_at,
          ]);
          break;
        }
        case "reactions": {
          const list = await rows(
            db,
            "SELECT r.*,m.nickname FROM reactions r JOIN activities a ON a.id=r.activity_id JOIN members m ON m.id=r.member_id AND m.course_id=a.course_id WHERE a.course_id=? ORDER BY r.activity_id,r.member_id",
            cid,
          );
          header = ["ID", "ID aktivity", "ID člena", "Prezývka", "Reakcia"];
          records = list.map((r) => [
            r.id,
            r.activity_id,
            r.member_id,
            r.nickname,
            "podpora",
          ]);
          break;
        }
      }
      const cell = (value: unknown) => {
        const text = String(value ?? "");
        // Quoting alone does not prevent spreadsheet formula execution. Protect
        // the first effective character, including imported leading whitespace.
        const safe = /^[\s\uFEFF]*[=+@-]/u.test(text) ? "'" + text : text;
        return '"' + safe.replaceAll('"', '""') + '"';
      };
      const csv =
        "\uFEFF" +
        [header, ...records].map((row) => row.map(cell).join(";")).join("\r\n");
      const filename = dataset === "activities" ? "aktivity" : dataset;
      return new Response(csv, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="cestou-zimy-${filename}.csv"`,
          "Cache-Control": "private, no-store",
          Vary: "Cookie",
          "X-Content-Type-Options": "nosniff",
        },
      });
    }
    if (path !== "/api/action" || request.method !== "POST")
      fail(404, "Stránka sa nenašla.");
    const raw = await request.text();
    if (raw.length > 50000) fail(413, "Požiadavka je príliš veľká.");
    const b = z.record(z.unknown()).parse(JSON.parse(raw)),
      action = required(b.action);
    const adminActions = [
      "saveCourse",
      "inviteMember",
      "resendInvite",
      "updateMember",
      "saveType",
      "saveRule",
      "previewRecalculation",
      "applyRecalculation",
      "saveChallenge",
      "publishChallenge",
      "endChallenge",
      "saveMessage",
      "sendMessage",
    ];
    if (adminActions.includes(action) && me.role !== "admin")
      fail(403, "Túto zmenu môže spraviť iba organizátor.");
    let result: Record<string, unknown> = {};
    switch (action) {
      case "saveActivity": {
        const old = b.id ? await ownedActivity(db, b.id, me, true) : null;
        const t = await one(
          db,
          "SELECT * FROM activity_types WHERE id=? AND course_id=? AND hidden=0",
          required(b.typeId),
          cid,
        );
        if (!t || (!t.active && old?.type_id !== t.id))
          fail(400, "Vyber dostupný typ aktivity.");
        if (t.group_name === "task")
          fail(400, "Dobrovoľnú úlohu označ vo Výzvach.");
        const d = date(b.date);
        if (d > today || d < course.startDate || d > course.endDate)
          fail(
            400,
            "Dátum musí byť v období prípravy a nesmie byť v budúcnosti.",
          );
        const minutes = numeric(b.minutes, 1440),
          distance = numeric(b.distance, 1000, true),
          note = str(b.note),
          key = required(b.idempotencyKey, 100);
        if (old) {
          await run(
            db,
            "UPDATE activities SET type_id=?,date=?,minutes=?,distance=?,note=?,updated_at=? WHERE id=?",
            t.id,
            d,
            minutes,
            distance,
            note,
            now,
            old.id,
          );
          result.id = old.id;
        } else {
          const id = uid();
          await run(
            db,
            "INSERT OR IGNORE INTO activities(id,course_id,member_id,type_id,date,minutes,distance,note,created_at,updated_at,idempotency_key) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
            id,
            cid,
            me.id,
            t.id,
            d,
            minutes,
            distance,
            note,
            now,
            now,
            key,
          );
          result.id = (
            await one(
              db,
              "SELECT id FROM activities WHERE course_id=? AND member_id=? AND idempotency_key=?",
              cid,
              me.id,
              key,
            )
          )?.id;
        }
        await recalculate(db, course, me.id, today, now);
        break;
      }
      case "deleteActivity": {
        const a = await ownedActivity(db, b.id, me, me.role !== "admin");
        await db.batch([
          db.prepare("DELETE FROM comments WHERE activity_id=?").bind(a.id),
          db.prepare("DELETE FROM reactions WHERE activity_id=?").bind(a.id),
          db.prepare("DELETE FROM activities WHERE id=?").bind(a.id),
        ]);
        await recalculate(db, course, a.member_id, today, now);
        if (a.member_id !== me.id)
          await log(
            db,
            cid,
            me.id,
            "moderateActivity",
            { id: a.id, memberId: a.member_id },
            now,
          );
        break;
      }
      case "reaction": {
        const a = await ownedActivity(db, b.activityId, me);
        const r = await one(
          db,
          "SELECT id FROM reactions WHERE activity_id=? AND member_id=?",
          a.id,
          me.id,
        );
        if (r) await run(db, "DELETE FROM reactions WHERE id=?", r.id);
        else
          await run(
            db,
            "INSERT OR IGNORE INTO reactions(id,activity_id,member_id) VALUES(?,?,?)",
            uid(),
            a.id,
            me.id,
          );
        break;
      }
      case "saveComment": {
        const a = await ownedActivity(db, b.activityId, me),
          body = required(b.body, 1000);
        if (b.id) {
          const c = await one(
            db,
            "SELECT * FROM comments WHERE id=? AND activity_id=?",
            required(b.id),
            a.id,
          );
          if (!c || c.member_id !== me.id)
            fail(403, "Môžeš upravovať iba vlastné komentáre.");
          await run(db, "UPDATE comments SET body=? WHERE id=?", body, c.id);
        } else
          await run(
            db,
            "INSERT INTO comments(id,activity_id,member_id,body,created_at) VALUES(?,?,?,?,?)",
            uid(),
            a.id,
            me.id,
            body,
            now,
          );
        break;
      }
      case "deleteComment": {
        const c = await one(
          db,
          "SELECT c.* FROM comments c JOIN activities a ON a.id=c.activity_id WHERE c.id=? AND a.course_id=?",
          required(b.id),
          cid,
        );
        if (!c) fail(404, "Komentár sa nenašiel.");
        if (c.member_id !== me.id && me.role !== "admin")
          fail(403, "Tento komentár nemôžeš vymazať.");
        await run(db, "DELETE FROM comments WHERE id=?", c.id);
        if (c.member_id !== me.id)
          await log(db, cid, me.id, "moderateComment", { id: c.id }, now);
        break;
      }
      case "completeGear":
      case "completeChallenge": {
        const isGear = action === "completeGear",
          id = isGear ? "gear" : required(b.id);
        let start = course.startDate,
          end = course.endDate;
        if (!isGear) {
          const r = await one(
            db,
            "SELECT data FROM challenges WHERE id=? AND course_id=? AND hidden=0 AND status!='draft'",
            id,
            cid,
          );
          if (!r) fail(404, "Výzva sa nenašla.");
          const c: Challenge = JSON.parse(r.data);
          if (!hasManual(c.condition))
            fail(400, "Táto výzva sa počíta z aktivít.");
          start = c.startDate;
          end = c.endDate;
        }
        const d = date(b.date || today);
        if (b.completed !== false && (d > today || d < start || d > end))
          fail(400, "Úlohu možno zapísať iba v jej období plnenia.");
        if (b.completed === false)
          await run(
            db,
            "DELETE FROM completions WHERE course_id=? AND member_id=? AND challenge_id=?",
            cid,
            me.id,
            id,
          );
        else
          await run(
            db,
            "INSERT INTO completions(id,course_id,member_id,challenge_id,date,note,created_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(course_id,member_id,challenge_id) DO UPDATE SET date=excluded.date,note=excluded.note",
            uid(),
            cid,
            me.id,
            id,
            d,
            str(b.note),
            now,
          );
        await recalculate(db, course, me.id, today, now);
        break;
      }
      case "saveProfile":
        await run(
          db,
          "UPDATE members SET nickname=?,animations=? WHERE id=?",
          required(b.nickname, 50),
          bool(b.animations) ? 1 : 0,
          me.id,
        );
        break;
      case "readMessage":
        await run(
          db,
          "UPDATE recipients SET read_at=COALESCE(read_at,?) WHERE message_id=? AND member_id=?",
          now,
          required(b.id),
          me.id,
        );
        break;
      case "pushStatus": {
        const subscription = await one(
            db,
            "SELECT id,data FROM subscriptions WHERE endpoint=? AND member_id=? AND course_id=?",
            str(b.endpoint, 4096),
            me.id,
            cid,
          ),
          applicationUrl = normalizeApplicationUrl(cfg.siteUrl);
        let registeredUrl = "";
        try {
          registeredUrl =
            JSON.parse(subscription?.data || "{}").applicationUrl || "";
        } catch {
          /* An invalid legacy record requires fresh enrollment. */
        }
        result.subscribed =
          !!subscription &&
          !!applicationUrl &&
          registeredUrl === applicationUrl;
        if (subscription && !result.subscribed) {
          await run(
            db,
            "DELETE FROM subscriptions WHERE id=? AND member_id=? AND course_id=?",
            subscription.id,
            me.id,
            cid,
          );
          result.reenrollRequired = true;
        }
        break;
      }

      case "pushSubscribe": {
        if (!(cfg.vapidPublicKey && cfg.vapidPrivateKey && cfg.vapidSubject))
          fail(
            503,
            "Push upozornenia ešte nemajú dokončené serverové nastavenie.",
          );
        const applicationUrl = normalizeApplicationUrl(cfg.siteUrl);
        if (!applicationUrl)
          fail(
            503,
            "Push upozornenia vyžadujú platnú adresu aplikácie APP_URL.",
          );
        let sub: ReturnType<typeof validateSubscription>;
        try {
          sub = validateSubscription(b.subscription);
        } catch (error) {
          fail(
            400,
            error instanceof Error
              ? error.message
              : "Neplatný odber upozornení.",
          );
        }
        await run(
          db,
          "INSERT INTO subscriptions(id,course_id,member_id,endpoint,data,created_at) VALUES(?,?,?,?,?,?) ON CONFLICT(endpoint) DO UPDATE SET course_id=excluded.course_id,member_id=excluded.member_id,data=excluded.data",
          uid(),
          cid,
          me.id,
          sub.endpoint,
          JSON.stringify({ ...sub, applicationUrl }),
          now,
        );
        break;
      }
      case "pushUnsubscribe":
        await run(
          db,
          "DELETE FROM subscriptions WHERE endpoint=? AND member_id=?",
          str(b.endpoint, 4096),
          me.id,
        );
        break;
      case "saveCourse": {
        const next: Course = {
          ...course,
          name: required(b.name),
          startDate: date(b.startDate),
          endDate: date(b.endDate),
          timezone: required(b.timezone, 60),
          squirrelLimit: z.number().int().min(0).max(5).parse(b.squirrelLimit),
          testMode: bool(b.testMode),
        };
        try {
          new Intl.DateTimeFormat("en-CA", { timeZone: next.timezone });
        } catch {
          fail(400, "Neplatná časová zóna.");
        }
        if (next.startDate > next.endDate)
          fail(400, "Koniec prípravy musí byť po začiatku.");
        if (
          new Date(next.endDate).getTime() -
            new Date(next.startDate).getTime() >
          730 * 86400000
        )
          fail(400, "Prípravné obdobie môže mať najviac dva roky.");
        const history = (
          await one(
            db,
            "SELECT (SELECT COUNT(*) FROM activities WHERE course_id=?) + (SELECT COUNT(*) FROM awards WHERE course_id=?) + (SELECT COUNT(*) FROM completions WHERE course_id=?) count",
            cid,
            cid,
            cid,
          )
        ).count;
        if (next.startDate !== course.startDate && history)
          fail(
            409,
            "Začiatok prípravy po prvých záznamoch nemožno meniť bez migrácie histórie.",
          );
        const outside = (
          await one(
            db,
            "SELECT (SELECT COUNT(*) FROM activities WHERE course_id=? AND (date<? OR date>?)) + (SELECT COUNT(*) FROM completions WHERE course_id=? AND (date<? OR date>?)) count",
            cid,
            next.startDate,
            next.endDate,
            cid,
            next.startDate,
            next.endDate,
          )
        ).count;
        if (outside)
          fail(
            409,
            "Existujú aktivity alebo potvrdené úlohy mimo nového obdobia. Najprv oprav ich dátumy.",
          );
        const preparedChallenges = (
          await rows(db, "SELECT data FROM challenges WHERE course_id=?", cid)
        ).map((r) => JSON.parse(r.data) as Challenge);
        if (
          preparedChallenges.some(
            (ch) =>
              ch.status !== "draft" &&
              (ch.startDate < next.startDate || ch.endDate > next.endDate),
          )
        )
          fail(
            409,
            "Zverejnená výzva by zostala mimo obdobia prípravy. Zachovaj jej dátumové hranice.",
          );
        const statements = [
          db
            .prepare("UPDATE courses SET data=? WHERE id=?")
            .bind(JSON.stringify(next), cid),
        ];
        if (!history && next.startDate !== course.startDate) {
          for (const r of await getRules(db, cid)) {
            if (r.effectiveFrom === course.startDate) {
              r.effectiveFrom = next.startDate;
              statements.push(
                db
                  .prepare(
                    "UPDATE rules SET data=?,effective_from=? WHERE id=?",
                  )
                  .bind(JSON.stringify(r), r.effectiveFrom, r.id),
              );
            }
          }
        }
        for (const ch of preparedChallenges) {
          if (
            ch.status === "draft" &&
            ch.startDate === course.startDate &&
            ch.endDate === course.endDate
          ) {
            ch.startDate = next.startDate;
            ch.endDate = next.endDate;
            statements.push(
              db
                .prepare("UPDATE challenges SET data=? WHERE id=?")
                .bind(JSON.stringify(ch), ch.id),
            );
          }
        }
        statements.push(
          db
            .prepare(
              "INSERT INTO audit(id,course_id,member_id,action,details,created_at) VALUES(?,?,?,?,?,?)",
            )
            .bind(uid(), cid, me.id, action, JSON.stringify(next), now),
        );
        await db.batch(statements);
        break;
      }
      case "inviteMember": {
        const email = z.string().email().max(254).parse(b.email).toLowerCase(),
          nickname = required(b.nickname, 50),
          role = z
            .enum(["participant", "admin"])
            .parse(b.role || "participant");
        const existing = await one(
          db,
          "SELECT id FROM members WHERE course_id=? AND email=?",
          cid,
          email,
        );
        if (existing)
          fail(
            409,
            "Tento e-mail už v kurze existuje. Použi správu členstva alebo opätovné odoslanie.",
          );
        const id = uid();
        await run(
          db,
          "INSERT INTO members(id,course_id,email,nickname,role,active,animations,joined_at) VALUES(?,?,?,?,?,1,1,?)",
          id,
          cid,
          email,
          nickname,
          role,
          now,
        );
        await enqueueInvite(db, cid, id, email, course, cfg, now);
        await log(db, cid, me.id, action, { id }, now);
        result = {
          id,
          warning: emailConfigured(cfg)
            ? "Pozvánka je vo fronte na odoslanie."
            : "Člen bol pridaný. E-mail nie je nakonfigurovaný; odovzdaj mu adresu aplikácie priamo.",
        };
        break;
      }
      case "resendInvite": {
        const m = await one(
          db,
          "SELECT * FROM members WHERE id=? AND course_id=? AND active=1",
          required(b.id),
          cid,
        );
        if (!m) fail(404, "Aktívny člen sa nenašiel.");
        await enqueueInvite(db, cid, m.id, m.email, course, cfg, now);
        result.warning = emailConfigured(cfg)
          ? "Pozvánka je vo fronte."
          : "E-mailový poskytovateľ nie je nakonfigurovaný.";
        break;
      }
      case "updateMember": {
        const m = await one(
          db,
          "SELECT * FROM members WHERE id=? AND course_id=?",
          required(b.id),
          cid,
        );
        if (!m) fail(404, "Člen sa nenašiel.");
        const role =
            b.role === undefined
              ? m.role
              : z.enum(["participant", "admin"]).parse(b.role),
          active = b.active === undefined ? m.active : bool(b.active) ? 1 : 0;
        const updated = await one(
          db,
          "UPDATE members SET role=?,active=?,nickname=? WHERE id=? AND (role!='admin' OR active!=1 OR (?='admin' AND ?=1) OR (SELECT COUNT(*) FROM members WHERE course_id=? AND role='admin' AND active=1)>1) RETURNING id",
          role,
          active,
          b.nickname ? required(b.nickname, 50) : m.nickname,
          m.id,
          role,
          active,
          cid,
        );
        if (!updated)
          fail(409, "V kurze musí zostať aspoň jeden aktívny organizátor.");
        if (!active)
          await db.batch([
            db
              .prepare("DELETE FROM subscriptions WHERE member_id=?")
              .bind(m.id),
            db
              .prepare(
                "UPDATE outbox SET status='cancelled' WHERE member_id=? AND status='pending'",
              )
              .bind(m.id),
          ]);
        await log(db, cid, me.id, action, { id: m.id, role, active }, now);
        break;
      }
      case "saveType": {
        const id = b.id ? required(b.id) : uid(),
          name = required(b.name, 60),
          group = z.enum(["foot", "exercise", "other"]).parse(b.group),
          active = bool(b.active) ? 1 : 0;
        const old = await one(
          db,
          "SELECT * FROM activity_types WHERE id=? AND course_id=?",
          id,
          cid,
        );
        if (old) {
          if (old.hidden || old.group_name === "task")
            fail(400, "Tajnú úlohu spravuj cez výzvy.");
          if (
            old.group_name !== group &&
            (
              await one(
                db,
                "SELECT COUNT(*) count FROM activities WHERE type_id=?",
                id,
              )
            ).count
          )
            fail(
              409,
              "Skupinu používaného typu nemožno meniť; vytvor nový typ, aby sa neprepísala história.",
            );
          await run(
            db,
            "UPDATE activity_types SET name=?,group_name=?,active=? WHERE id=?",
            name,
            group,
            active,
            id,
          );
        } else
          await run(
            db,
            "INSERT INTO activity_types(id,course_id,name,group_name,hidden,active) VALUES(?,?,?,?,0,?)",
            id,
            cid,
            name,
            group,
            active,
          );
        await log(db, cid, me.id, action, { id }, now);
        break;
      }
      case "saveRule": {
        const old = await one(
          db,
          "SELECT data FROM rules WHERE id=? AND course_id=?",
          required(b.id),
          cid,
        );
        if (!old) fail(404, "Pravidlo sa nenašlo.");
        const r: Rule = JSON.parse(old.data),
          latest = (await getRules(db, cid))
            .filter((x) => x.key === r.key)
            .sort((a, b) => a.version - b.version)
            .at(-1)!;
        const effectiveFrom =
          r.period === "week"
            ? addDays(weekStart(today), 7)
            : addDays(course.endDate, 1);
        const condition = parseCondition(b.condition);
        if (
          r.key === "equipment"
            ? condition.kind !== "manual"
            : hasManual(condition)
        )
          fail(
            400,
            "Výbava používa manuálne potvrdenie. Ostatné základné odmeny musia vychádzať z pohybových záznamov.",
          );
        const next: Rule = {
          ...r,
          id: uid(),
          version: latest.version + 1,
          effectiveFrom,
          name: required(b.name),
          description: str(b.description),
          gem: required(b.gem, 40),
          condition,
          active: bool(b.active),
        };
        await run(
          db,
          "INSERT INTO rules(id,course_id,key,version,effective_from,data) VALUES(?,?,?,?,?,?)",
          next.id,
          cid,
          next.key,
          next.version,
          effectiveFrom,
          JSON.stringify(next),
        );
        await log(
          db,
          cid,
          me.id,
          action,
          { key: r.key, version: next.version, effectiveFrom },
          now,
        );
        result.warning = `Nová verzia platí od ${effectiveFrom}. História ostáva zachovaná. Spätný prepočet je samostatná akcia s náhľadom.`;
        break;
      }
      case "previewRecalculation":
      case "applyRecalculation": {
        const ruleKey = required(b.ruleKey),
          rules = await getRules(db, cid),
          latest = rules.filter((r) => r.key === ruleKey).at(-1);
        if (!latest) fail(404, "Pravidlo sa nenašlo.");
        const acts = await getActivities(db, cid),
          completions = await rows(
            db,
            "SELECT * FROM completions WHERE course_id=? ORDER BY id",
            cid,
          ),
          allAwards = await getAwards(db, cid),
          members = await rows(
            db,
            "SELECT * FROM members WHERE course_id=? AND active=1 ORDER BY id",
            cid,
          );
        const fingerprint = JSON.stringify({
            course,
            today,
            rules,
            acts,
            completions,
            allAwards,
            members: members.map((m) => m.id),
          }),
          candidate = { ...latest, effectiveFrom: course.startDate };
        const changes = members.map((m) => {
          const before = allAwards.filter(
            (a) => a.memberId === m.id && a.ruleKey === ruleKey,
          );
          const after = progressFor(
            [candidate],
            acts.filter((a) => a.memberId === m.id),
            course,
            today,
            completions
              .filter((c) => c.member_id === m.id && c.challenge_id === "gear")
              .map((c) => c.date),
          ).filter((p) => p.progress.complete && candidate.active);
          const addedPeriods = after
            .filter((p) => !before.some((a) => a.periodStart === p.periodStart))
            .map((p) => ({ startDate: p.periodStart, endDate: p.periodEnd }));
          const removedPeriods = before
            .filter((a) => !after.some((p) => p.periodStart === a.periodStart))
            .map((a) => ({ startDate: a.periodStart, endDate: a.periodEnd }));
          const changedPeriods = after
            .filter((p) =>
              before.some(
                (a) =>
                  a.periodStart === p.periodStart &&
                  JSON.stringify(a.snapshot) !== JSON.stringify(candidate),
              ),
            )
            .map((p) => ({
              startDate: p.periodStart,
              endDate: p.periodEnd,
              fromVersion: before.find((a) => a.periodStart === p.periodStart)!
                .ruleVersion,
              toVersion: latest.version + 1,
            }));
          return {
            memberId: m.id,
            nickname: m.nickname,
            before: before.length,
            after: after.length,
            addedPeriods,
            removedPeriods,
            changedPeriods,
          };
        });
        if (action === "previewRecalculation") {
          const previewToken = uid();
          await run(
            db,
            "INSERT INTO recalculation_previews(id,course_id,member_id,rule_key,fingerprint,expires_at) VALUES(?,?,?,?,?,?)",
            previewToken,
            cid,
            me.id,
            ruleKey,
            fingerprint,
            new Date(new Date(now).getTime() + 600000).toISOString(),
          );
          result = {
            previewToken,
            changes,
            warning:
              "Spätný prepočet použije najnovšie pravidlo na celú prípravu. Odmeny môže udeliť aj odobrať.",
          };
        } else {
          const preview = await one(
            db,
            "SELECT * FROM recalculation_previews WHERE id=? AND course_id=? AND member_id=? AND rule_key=?",
            required(b.previewToken),
            cid,
            me.id,
            ruleKey,
          );
          if (
            !preview ||
            preview.expires_at <= now ||
            preview.fingerprint !== fingerprint
          )
            fail(
              409,
              "Náhľad vypršal alebo sa zmenili údaje. Vytvor nový náhľad.",
            );
          candidate.id = uid();
          candidate.version = latest.version + 1;
          const statements = [
            db
              .prepare(
                "INSERT INTO rules(id,course_id,key,version,effective_from,data) VALUES(?,?,?,?,?,?)",
              )
              .bind(
                candidate.id,
                cid,
                ruleKey,
                candidate.version,
                candidate.effectiveFrom,
                JSON.stringify(candidate),
              ),
          ];
          for (const m of members) {
            const before = allAwards.filter(
              (a) => a.memberId === m.id && a.ruleKey === ruleKey,
            );
            const after = progressFor(
              [candidate],
              acts.filter((a) => a.memberId === m.id),
              course,
              today,
              completions
                .filter(
                  (c) => c.member_id === m.id && c.challenge_id === "gear",
                )
                .map((c) => c.date),
            ).filter((p) => p.progress.complete && candidate.active);
            for (const a of before)
              if (!after.some((p) => p.periodStart === a.periodStart))
                statements.push(
                  db.prepare("DELETE FROM awards WHERE id=?").bind(a.id),
                );
            for (const p of after) {
              const existing = before.find(
                (a) => a.periodStart === p.periodStart,
              );
              if (existing)
                statements.push(
                  db
                    .prepare(
                      "UPDATE awards SET rule_version=?,snapshot=?,period_end=? WHERE id=?",
                    )
                    .bind(
                      candidate.version,
                      JSON.stringify(candidate),
                      p.periodEnd,
                      existing.id,
                    ),
                );
              else
                statements.push(
                  db
                    .prepare(
                      "INSERT INTO awards(id,course_id,member_id,rule_key,period_start,period_end,rule_version,earned_at,snapshot) VALUES(?,?,?,?,?,?,?,?,?)",
                    )
                    .bind(
                      uid(),
                      cid,
                      m.id,
                      ruleKey,
                      p.periodStart,
                      p.periodEnd,
                      candidate.version,
                      now,
                      JSON.stringify(candidate),
                    ),
                );
            }
          }
          statements.push(
            db
              .prepare("DELETE FROM recalculation_previews WHERE id=?")
              .bind(preview.id),
          );
          statements.push(
            db
              .prepare(
                "INSERT INTO audit(id,course_id,member_id,action,details,created_at) VALUES(?,?,?,?,?,?)",
              )
              .bind(
                uid(),
                cid,
                me.id,
                action,
                JSON.stringify({ ruleKey, changes }),
                now,
              ),
          );
          // A failed member update cannot leave a new historical rule partly applied.
          await db.batch(statements);
          result.changes = changes;
        }
        break;
      }
      case "saveChallenge": {
        const old = b.id
          ? await one(
              db,
              "SELECT data FROM challenges WHERE id=? AND course_id=?",
              required(b.id),
              cid,
            )
          : null;
        if (b.id && !old) fail(404, "Výzva sa nenašla.");
        const prior: Challenge | undefined = old
          ? JSON.parse(old.data)
          : undefined;
        const startDate = date(b.startDate),
          endDate = date(b.endDate);
        validatePeriod(startDate, endDate, course);
        if (prior && prior.status !== "draft")
          fail(
            409,
            "Publikovanú výzvu nemožno spätne prepísať. Ukonči ju a vytvor novú.",
          );
        const ch: Challenge = {
          id: prior?.id || uid(),
          name: required(b.name),
          description: str(b.description),
          startDate,
          endDate,
          condition: parseCondition(b.condition),
          reward: required(b.reward, 60),
          status: "draft",
          hidden: prior?.hidden ?? bool(b.hidden ?? false),
          typeId: prior?.typeId || null,
          createdAt: prior?.createdAt || now,
          publishedAt: null,
        };
        if (prior)
          await run(
            db,
            "UPDATE challenges SET data=? WHERE id=?",
            JSON.stringify(ch),
            ch.id,
          );
        else
          await run(
            db,
            "INSERT INTO challenges(id,course_id,data,status,hidden) VALUES(?,?,?,?,?)",
            ch.id,
            cid,
            JSON.stringify(ch),
            "draft",
            ch.hidden ? 1 : 0,
          );
        result.id = ch.id;
        await log(db, cid, me.id, action, { id: ch.id }, now);
        break;
      }
      case "publishChallenge":
      case "endChallenge": {
        const r = await one(
          db,
          "SELECT data FROM challenges WHERE id=? AND course_id=?",
          required(b.id),
          cid,
        );
        if (!r) fail(404, "Výzva sa nenašla.");
        const ch: Challenge = JSON.parse(r.data);
        if (action === "publishChallenge" && ch.status === "ended")
          fail(
            409,
            "Ukončenú výzvu nemožno znovu otvoriť. Vytvor novú výzvu s novým obdobím.",
          );
        if (action === "publishChallenge")
          validatePeriod(ch.startDate, ch.endDate, course);
        if (action === "endChallenge" && ch.status === "draft")
          fail(400, "Najprv výzvu zverejni.");
        // Explicit closing is inclusive today. If closed before its start, the window
        // is intentionally empty; no past or later activity can qualify.
        if (action === "endChallenge" && today < ch.endDate) ch.endDate = today;
        const already = ch.status === "published" && !ch.hidden;
        ch.status = action === "publishChallenge" ? "published" : "ended";
        ch.hidden = false;
        ch.publishedAt = ch.publishedAt || now;
        const stmts = [
          db
            .prepare(
              "UPDATE challenges SET data=?,status=?,hidden=0 WHERE id=?",
            )
            .bind(JSON.stringify(ch), ch.status, ch.id),
        ];
        if (ch.typeId)
          stmts.push(
            db
              .prepare(
                "UPDATE activity_types SET hidden=0 WHERE id=? AND course_id=?",
              )
              .bind(ch.typeId, cid),
          );
        await db.batch(stmts);
        if (action === "publishChallenge" && b.announce && !already) {
          const message: Message = {
            id: "challenge-" + ch.id,
            title: "Nová výzva: " + ch.name,
            body: ch.description,
            link: "/?view=challenges",
            important: false,
            pinned: false,
            status: "draft",
            audience: "all",
            createdAt: now,
            sentAt: null,
          };
          await run(
            db,
            "INSERT OR IGNORE INTO messages(id,course_id,data,status,created_at) VALUES(?,?,?,?,?)",
            message.id,
            cid,
            JSON.stringify(message),
            "draft",
            now,
          );
          await sendMessage(db, message.id, course, now);
        }
        await log(db, cid, me.id, action, { id: ch.id }, now);
        break;
      }
      case "saveMessage": {
        const old = b.id
          ? await one(
              db,
              "SELECT * FROM messages WHERE id=? AND course_id=?",
              required(b.id),
              cid,
            )
          : null;
        if (b.id && !old) fail(404, "Správa sa nenašla.");
        const previous: Message | undefined = old
          ? JSON.parse(old.data)
          : undefined;
        const recipients = z
            .array(z.string())
            .max(200)
            .parse(b.recipients || []),
          audience = z.enum(["all", "selected"]).parse(b.audience);
        if (audience === "selected" && !recipients.length)
          fail(400, "Vyber aspoň jedného adresáta.");
        for (const id of recipients)
          if (
            !(await one(
              db,
              "SELECT id FROM members WHERE id=? AND course_id=? AND active=1",
              id,
              cid,
            ))
          )
            fail(400, "Vybraný adresát nie je aktívnym členom kurzu.");
        const m: Message = {
          id: previous?.id || uid(),
          title: required(b.title, 120),
          body: required(b.body, 8000),
          link: safeLink(b.link),
          important: bool(b.important),
          pinned: bool(b.pinned) && bool(b.important),
          status: old?.status || "draft",
          audience: previous?.status === "sent" ? previous.audience : audience,
          recipients:
            previous?.status === "sent" ? previous.recipients : recipients,
          push: bool(b.push ?? false),
          createdAt: previous?.createdAt || now,
          sentAt: old?.sent_at || null,
        };
        if (old)
          await run(
            db,
            "UPDATE messages SET data=? WHERE id=?",
            JSON.stringify(m),
            m.id,
          );
        else
          await run(
            db,
            "INSERT INTO messages(id,course_id,data,status,created_at) VALUES(?,?,?,?,?)",
            m.id,
            cid,
            JSON.stringify(m),
            "draft",
            now,
          );
        result.id = m.id;
        await log(db, cid, me.id, action, { id: m.id }, now);
        break;
      }
      case "sendMessage": {
        const id = required(b.id);
        await sendMessage(db, id, course, now);
        await log(db, cid, me.id, action, { id }, now);
        result.warning =
          "Správa je v aplikácii. Zvolený push sa spracuje serverovo; prijatie poskytovateľom nie je potvrdením doručenia ani prečítania.";
        break;
      }
      default:
        fail(400, "Neznáma akcia.");
    }
    return json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof HttpError)
      return json({ error: error.message }, error.status);
    if (error instanceof z.ZodError || error instanceof SyntaxError)
      return json({ error: "Skontroluj vyplnené údaje a ich rozsah." }, 400);
    console.error(
      "Request failed",
      error instanceof Error ? error.message : "unknown",
    );
    return json(
      {
        error:
          "Požiadavku sa nepodarilo dokončiť. Údaje vo formulári zostali zachované.",
      },
      500,
    );
  }
}
async function enqueueInvite(
  db: Database,
  cid: string,
  mid: string,
  email: string,
  course: Course,
  cfg: ServerConfig,
  now: string,
) {
  // Email is transactional; creating membership never opts in to newsletters.
  if (!emailConfigured(cfg)) return;
  await run(
    db,
    "INSERT INTO outbox(id,course_id,member_id,kind,reference_id,payload,status,attempts,next_attempt,created_at) VALUES(?,?,?,?,?,?,?,0,?,?)",
    uid(),
    cid,
    mid,
    "email",
    uid(),
    JSON.stringify({
      to: email,
      subject: "Pozvánka · " + course.name,
      text: `Máš pozvánku do prípravy Cestou Zimy. Prihlás sa účtom s adresou ${email}: ${cfg.siteUrl || ""}`,
    }),
    "pending",
    now,
    now,
  );
}
async function sendMessage(
  db: Database,
  id: string,
  course: Course,
  now: string,
) {
  const r = await one(
    db,
    "SELECT * FROM messages WHERE id=? AND course_id=?",
    id,
    course.id,
  );
  if (!r) fail(404, "Správa sa nenašla.");
  if (r.status === "sent") return;
  const m: Message = JSON.parse(r.data),
    all = await rows(
      db,
      "SELECT id FROM members WHERE course_id=? AND active=1",
      course.id,
    ),
    target = all.filter(
      (x) => m.audience === "all" || m.recipients?.includes(x.id),
    );
  m.status = "sent";
  m.sentAt = now;
  const statements = [
    db
      .prepare(
        "UPDATE messages SET data=?,status='sent',sent_at=COALESCE(sent_at,?) WHERE id=?",
      )
      .bind(JSON.stringify(m), now, id),
  ];
  for (const t of target) {
    statements.push(
      db
        .prepare(
          "INSERT OR IGNORE INTO recipients(id,message_id,member_id) VALUES(?,?,?)",
        )
        .bind(uid(), id, t.id),
    );
    if (m.push)
      statements.push(
        db
          .prepare(
            "INSERT OR IGNORE INTO outbox(id,course_id,member_id,kind,reference_id,payload,status,attempts,next_attempt,created_at) VALUES(?,?,?,?,?,?,'pending',0,?,?)",
          )
          .bind(
            uid(),
            course.id,
            t.id,
            "push",
            id,
            JSON.stringify({
              title: "Cestou Zimy",
              body: "Máš novú správu od organizátora.",
              url: "/?view=messages&message=" + encodeURIComponent(id),
              tag: "message-" + id,
            }),
            now,
            now,
          ),
      );
  }
  await db.batch(statements);
}
