import { z } from "zod";
import { rows, one, run, uid, type Database } from "./database.ts";
import { addDays, validDate } from "./dates.ts";
import type {
  Course,
  Member,
  Challenge,
  ColdEntry,
  ColdState,
  RewardVisual,
  PersonalAwardDefinition,
  PersonalAwardGrant,
  Motto,
} from "./types.ts";
import { DEFAULT_MOTTOS } from "./motto-catalog.ts";
import { DEFAULT_PERSONAL_AWARDS } from "./award-catalog.ts";

export class CommunityError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
export function reject(status: number, message: string): never {
  throw new CommunityError(status, message);
}
export const textValue = (value: unknown, max = 2000) =>
  z
    .string()
    .trim()
    .max(max)
    .parse(value ?? "");
export const requiredValue = (value: unknown, max = 100) =>
  z.string().trim().min(1).max(max).parse(value);
export function dateValue(value: unknown): string {
  if (typeof value !== "string" || !validDate(value))
    reject(400, "Neplatný dátum.");
  return value;
}
export function requireAdmin(me: Member) {
  if (me.role !== "admin")
    reject(403, "Túto zmenu môže spraviť iba organizátor.");
}
export async function tableExists(
  db: Database,
  table: string,
): Promise<boolean> {
  return !!(await one(
    db,
    "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
    table,
  ));
}
export const rewardIcons = [
  "glove",
  "tent",
  "compass",
  "patch",
  "footprints",
  "nut",
  "snowflake",
  "backpack",
  "drop",
  "mountain",
  "flame",
  "leaf",
  "star",
  "heart",
  "moon",
  "sun",
  "tool",
  "bear",
  "boot",
  "knot",
  "handshake",
] as const;
export function parseVisual(value: unknown): RewardVisual {
  const visual = z
    .object({
      kind: z.enum(["gem", "icon", "image"]),
      value: z.string().trim().min(1).max(100),
      color: z
        .string()
        .regex(/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/)
        .optional(),
    })
    .parse(value);
  if (
    visual.kind === "icon" &&
    !rewardIcons.includes(visual.value as (typeof rewardIcons)[number])
  )
    reject(400, "Vyber podporovanú ikonu odmeny.");
  if (visual.kind === "image" && !/^[a-zA-Z0-9_-]+$/.test(visual.value))
    reject(400, "Vyber nahratý obrázok odmeny.");
  return visual;
}
export async function visualStatements(
  db: Database,
  cid: string,
  resourceId: string,
  visual?: RewardVisual,
) {
  if (visual?.kind !== "image") return [];
  if (!(await tableExists(db, "media")))
    reject(400, "Nahrávanie obrázkov nie je dostupné.");
  const media = await one(
    db,
    "SELECT id,resource_id FROM media WHERE id=? AND course_id=? AND kind='award'",
    visual.value,
    cid,
  );
  if (!media || (media.resource_id && media.resource_id !== resourceId))
    reject(400, "Obrázok nepatrí k tejto odmene.");
  return [
    db
      .prepare("UPDATE media SET resource_id=? WHERE id=? AND course_id=?")
      .bind(resourceId, media.id, cid),
  ];
}
function publicVisual(visual: RewardVisual, basePath: string): RewardVisual {
  return visual.kind === "image"
    ? {
        ...visual,
        url: `${basePath}/api/media/${encodeURIComponent(visual.value)}`,
      }
    : visual;
}
export async function seedCommunity(db: Database, course: Course, now: string) {
  const version = "community-v1";
  if (
    await one(
      db,
      "SELECT version FROM community_seed_versions WHERE course_id=? AND version=?",
      course.id,
      version,
    )
  )
    return;
  const statements = [];
  for (const [index, item] of DEFAULT_PERSONAL_AWARDS.entries()) {
    const definition: PersonalAwardDefinition = {
      ...item,
      id: `${course.id}-practical-${index + 1}`,
      status: "draft",
      createdAt: now,
    };
    statements.push(
      db
        .prepare(
          "INSERT OR IGNORE INTO personal_award_definitions(id,course_id,data,status) VALUES(?,?,?,'draft')",
        )
        .bind(definition.id, course.id, JSON.stringify(definition)),
    );
  }
  for (const [index, item] of DEFAULT_MOTTOS.entries()) {
    const motto: Motto = {
      ...item,
      id: `${course.id}-motto-${index + 1}`,
      order: index,
    };
    statements.push(
      db
        .prepare(
          "INSERT OR IGNORE INTO mottos(id,course_id,data,active,position) VALUES(?,?,?,?,?)",
        )
        .bind(
          motto.id,
          course.id,
          JSON.stringify(motto),
          motto.active ? 1 : 0,
          index,
        ),
    );
  }
  statements.push(
    db
      .prepare(
        "INSERT OR IGNORE INTO community_seed_versions(course_id,version) VALUES(?,?)",
      )
      .bind(course.id, version),
  );
  await db.batch(statements);
}
export function isColdChallenge(
  ch: Pick<Challenge, "id" | "kind">,
  cid: string,
): boolean {
  return ch.kind === "cold" || ch.id === `${cid}-cold`;
}
export function coldAvailableFrom(
  course: Course,
  challenge: Challenge,
): string {
  const unlock = addDays(course.startDate, (course.coldUnlockDay ?? 8) - 1);
  return challenge.startDate > unlock ? challenge.startDate : unlock;
}
export function visibleChallenge(ch: Challenge, course: Course, today: string) {
  return (
    !ch.hidden &&
    ch.status !== "draft" &&
    (!isColdChallenge(ch, course.id) || today >= coldAvailableFrom(course, ch))
  );
}
export async function getColdChallenge(
  db: Database,
  course: Course,
): Promise<Challenge | null> {
  const data = await rows(
    db,
    "SELECT data FROM challenges WHERE course_id=? ORDER BY id",
    course.id,
  );
  return (
    data
      .map((row) => JSON.parse(row.data) as Challenge)
      .find((ch) => isColdChallenge(ch, course.id)) ?? null
  );
}
export async function getColdEntries(
  db: Database,
  cid: string,
  activeOnly = true,
): Promise<ColdEntry[]> {
  const data = await rows(
    db,
    `SELECT e.* FROM cold_entries e JOIN members m ON m.id=e.member_id AND m.course_id=e.course_id WHERE e.course_id=? ${activeOnly ? "AND m.active=1" : ""} ORDER BY e.date,e.member_id`,
    cid,
  );
  return data.map((e) => ({
    id: e.id,
    memberId: e.member_id,
    date: e.date,
    kind: e.kind,
    note: e.note,
    createdAt: e.created_at,
  }));
}
export async function getColdState(
  db: Database,
  course: Course,
  me: Member,
  today: string,
): Promise<ColdState | null> {
  const ch = await getColdChallenge(db, course);
  if (!ch || !visibleChallenge(ch, course, today)) return null;
  const availableFrom = coldAvailableFrom(course, ch),
    endDate = ch.endDate < course.endDate ? ch.endDate : course.endDate;
  const all = (await getColdEntries(db, course.id)).filter(
    (e) => e.date >= course.startDate && e.date <= endDate && e.date <= today,
  );
  const daily = new Map<string, Set<string>>();
  for (const e of all) {
    const people = daily.get(e.date) ?? new Set<string>();
    people.add(e.memberId);
    daily.set(e.date, people);
  }
  return {
    challengeId: ch.id,
    name: "Studená sprcha alebo otužovanie",
    description: ch.description,
    visual: ch.visual ?? { kind: "icon", value: "snowflake" },
    availableFrom,
    endDate,
    // An ended challenge still accepts corrections within its inclusive past
    // window. Ending before the unlock/start date leaves no recordable day.
    canRecord: availableFrom <= today && availableFrom <= endDate,
    entries: all.filter((e) => e.memberId === me.id),
    calendar: all.map(({ memberId, date, kind }) => ({ memberId, date, kind })),
    daily: [...daily].map(([date, people]) => ({ date, people: people.size })),
    people: new Set(all.map((e) => e.memberId)).size,
    entryDays: all.length,
    activeCount: Number(
      (
        await one(
          db,
          "SELECT COUNT(*) count FROM members WHERE course_id=? AND active=1",
          course.id,
        )
      ).count,
    ),
  };
}
export async function getPersonalAwards(
  db: Database,
  cid: string,
  admin = false,
  basePath = "",
) {
  const definitions = (
    await rows(
      db,
      "SELECT data FROM personal_award_definitions WHERE course_id=?" +
        (admin ? "" : " AND status='published'") +
        " ORDER BY id",
      cid,
    )
  )
    .map((r) => JSON.parse(r.data) as PersonalAwardDefinition)
    .map((d) => ({ ...d, visual: publicVisual(d.visual, basePath) }));
  const grants: PersonalAwardGrant[] = (
    await rows(
      db,
      `SELECT g.* FROM personal_award_grants g JOIN members m ON m.id=g.member_id AND m.course_id=g.course_id WHERE g.course_id=? ${admin ? "" : "AND m.active=1"} ORDER BY g.date DESC,g.created_at DESC`,
      cid,
    )
  ).map((r) => {
    const snapshot: PersonalAwardDefinition = JSON.parse(r.snapshot);
    return {
      id: r.id,
      definitionId: r.definition_id,
      memberId: r.member_id,
      date: r.date,
      reason: r.reason,
      grantedBy: r.granted_by,
      source: r.source,
      snapshot: {
        ...snapshot,
        visual: publicVisual(snapshot.visual, basePath),
      },
      createdAt: r.created_at,
    };
  });
  return { personalAwardDefinitions: definitions, personalAwards: grants };
}
export async function getMottos(db: Database, cid: string): Promise<Motto[]> {
  return (
    await rows(
      db,
      "SELECT data FROM mottos WHERE course_id=? ORDER BY position,id",
      cid,
    )
  ).map((r) => JSON.parse(r.data));
}
export async function dailyMotto(
  db: Database,
  course: Course,
  today: string,
): Promise<Motto | null> {
  if (course.mottoStartDate && today < course.mottoStartDate) return null;
  const candidates = (await getMottos(db, course.id)).filter(
    (m) =>
      m.active &&
      (!m.dateFrom || m.dateFrom <= today) &&
      (!m.dateTo || m.dateTo >= today),
  );
  if (!candidates.length) return null;
  const prior = await one(
    db,
    "SELECT snapshot FROM motto_daily WHERE course_id=? AND date=?",
    course.id,
    today,
  );
  if (prior) {
    const motto: Motto = JSON.parse(prior.snapshot);
    if (candidates.some((m) => m.id === motto.id)) return motto;
  }
  const elapsed = Math.floor(
    (Date.parse(today + "T12:00:00Z") -
      Date.parse((course.mottoStartDate || course.startDate) + "T12:00:00Z")) /
      86400000,
  );
  const selected =
    candidates[
      ((elapsed % candidates.length) + candidates.length) % candidates.length
    ];
  await run(
    db,
    "INSERT INTO motto_daily(course_id,date,motto_id,snapshot) VALUES(?,?,?,?) ON CONFLICT(course_id,date) DO UPDATE SET motto_id=excluded.motto_id,snapshot=excluded.snapshot",
    course.id,
    today,
    selected.id,
    JSON.stringify(selected),
  );
  return selected;
}
async function audit(
  db: Database,
  course: Course,
  me: Member,
  action: string,
  details: unknown,
  now: string,
) {
  await run(
    db,
    "INSERT INTO audit(id,course_id,member_id,action,details,created_at) VALUES(?,?,?,?,?,?)",
    uid(),
    course.id,
    me.id,
    action,
    JSON.stringify(details),
    now,
  );
}

export async function communityAction(
  db: Database,
  course: Course,
  me: Member,
  today: string,
  now: string,
  action: string,
  b: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  const cid = course.id;
  if (action === "saveColdEntry" || action === "deleteColdEntry") {
    const ch = await getColdChallenge(db, course);
    if (!ch || !visibleChallenge(ch, course, today))
      reject(404, "Výzva zatiaľ nie je dostupná.");
    if (action === "deleteColdEntry") {
      const entry = await one(
        db,
        "SELECT * FROM cold_entries WHERE id=? AND course_id=? AND member_id=?",
        requiredValue(b.id),
        cid,
        me.id,
      );
      if (!entry) reject(404, "Záznam sa nenašiel.");
      const legacyWhere =
        "course_id=? AND member_id=? AND type_id=? AND date=?";
      const legacyParams = [cid, me.id, ch.typeId, entry.date];
      const statements = [
        db
          .prepare(
            `DELETE FROM comments WHERE activity_id IN (SELECT id FROM activities WHERE ${legacyWhere})`,
          )
          .bind(...legacyParams),
        db
          .prepare(
            `DELETE FROM reactions WHERE activity_id IN (SELECT id FROM activities WHERE ${legacyWhere})`,
          )
          .bind(...legacyParams),
        db
          .prepare(
            "DELETE FROM cold_entries WHERE id=? AND course_id=? AND member_id=?",
          )
          .bind(entry.id, cid, me.id),
        db
          .prepare(
            "DELETE FROM completions WHERE course_id=? AND member_id=? AND challenge_id=? AND date=?",
          )
          .bind(cid, me.id, ch.id, entry.date),
        db
          .prepare(
            "DELETE FROM activities WHERE course_id=? AND member_id=? AND type_id=? AND date=?",
          )
          .bind(cid, me.id, ch.typeId, entry.date),
      ];
      await db.batch(statements);
      return {};
    }
    const day = dateValue(b.date),
      from = coldAvailableFrom(course, ch);
    if (day < from || day > today || day > course.endDate || day > ch.endDate)
      reject(
        400,
        "Záznam patrí do zverejnenej výzvy, najskôr od ôsmeho dňa prípravy; budúci deň nemožno potvrdiť.",
      );
    const kind = z.enum(["shower", "outdoor"]).parse(b.kind),
      note = textValue(b.note, 2000);
    await run(
      db,
      "INSERT INTO cold_entries(id,course_id,member_id,date,kind,note,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(course_id,member_id,date) DO UPDATE SET kind=excluded.kind,note=excluded.note,updated_at=excluded.updated_at",
      uid(),
      cid,
      me.id,
      day,
      kind,
      note,
      now,
      now,
    );
    return {
      id: (
        await one(
          db,
          "SELECT id FROM cold_entries WHERE course_id=? AND member_id=? AND date=?",
          cid,
          me.id,
          day,
        )
      ).id,
    };
  }
  if (action === "archiveMessage") {
    const id = requiredValue(b.id),
      archived = b.archived !== false;
    const recipient = await one(
      db,
      "SELECT r.id,m.data FROM recipients r JOIN messages m ON m.id=r.message_id WHERE r.message_id=? AND r.member_id=? AND m.course_id=? AND m.status='sent'",
      id,
      me.id,
      cid,
    );
    if (
      !recipient ||
      (JSON.parse(recipient.data).kind === "membership_request" &&
        me.role !== "admin")
    )
      reject(404, "Správa sa nenašla.");
    await run(
      db,
      "UPDATE recipients SET archived_at=?,acknowledged_at=COALESCE(acknowledged_at,?),read_at=COALESCE(read_at,?) WHERE id=?",
      archived ? now : null,
      archived ? now : null,
      archived ? now : null,
      recipient.id,
    );
    return {};
  }
  if (action === "saveAwardDefinition") {
    requireAdmin(me);
    const old = b.id
      ? await one(
          db,
          "SELECT data FROM personal_award_definitions WHERE id=? AND course_id=?",
          requiredValue(b.id),
          cid,
        )
      : null;
    if (b.id && !old) reject(404, "Ocenenie sa nenašlo.");
    const previous = old ? JSON.parse(old.data) : null;
    const definition: PersonalAwardDefinition = {
      id: previous?.id || uid(),
      name: requiredValue(b.name),
      description: textValue(b.description),
      visual: parseVisual(b.visual),
      mode: z.enum(["self", "organizer"]).parse(b.mode),
      status: z.enum(["draft", "published"]).parse(b.status),
      createdAt: previous?.createdAt || now,
    };
    const media = await visualStatements(
      db,
      cid,
      definition.id,
      definition.visual,
    );
    await db.batch([
      db
        .prepare(
          "INSERT INTO personal_award_definitions(id,course_id,data,status) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,status=excluded.status",
        )
        .bind(
          definition.id,
          cid,
          JSON.stringify(definition),
          definition.status,
        ),
      ...media,
    ]);
    await audit(db, course, me, action, { id: definition.id }, now);
    return { id: definition.id };
  }
  if (action === "grantPersonalAward" || action === "confirmPersonalAward") {
    if (action === "grantPersonalAward") requireAdmin(me);
    const row = await one(
      db,
      "SELECT data FROM personal_award_definitions WHERE id=? AND course_id=?",
      requiredValue(b.definitionId),
      cid,
    );
    if (!row) reject(404, "Ocenenie sa nenašlo.");
    const definition: PersonalAwardDefinition = JSON.parse(row.data);
    if (definition.status !== "published")
      reject(409, "Ocenenie musí byť najskôr zverejnené.");
    if (action === "confirmPersonalAward" && definition.mode !== "self")
      reject(403, "Toto ocenenie udeľuje organizátor.");
    const target =
      action === "confirmPersonalAward" ? me.id : requiredValue(b.memberId);
    if (
      !(await one(
        db,
        "SELECT id FROM members WHERE id=? AND course_id=? AND active=1",
        target,
        cid,
      ))
    )
      reject(404, "Člen sa nenašiel.");
    if (action === "confirmPersonalAward" && b.completed === false) {
      await run(
        db,
        "DELETE FROM personal_award_grants WHERE course_id=? AND member_id=? AND definition_id=? AND source='self'",
        cid,
        me.id,
        definition.id,
      );
      return {};
    }
    const day = dateValue(b.date || today);
    if (day < course.startDate || day > course.endDate || day > today)
      reject(400, "Dátum ocenenia musí byť v príprave a nie v budúcnosti.");
    const source = action === "confirmPersonalAward" ? "self" : "organizer",
      reason =
        action === "grantPersonalAward"
          ? requiredValue(b.reason, 2000)
          : textValue(b.reason, 2000);
    const old = await one(
      db,
      "SELECT id,source FROM personal_award_grants WHERE course_id=? AND member_id=? AND definition_id=?",
      cid,
      target,
      definition.id,
    );
    if (old) {
      if (action === "confirmPersonalAward" && old.source === "self") {
        await run(
          db,
          "UPDATE personal_award_grants SET date=?,reason=? WHERE id=? AND course_id=? AND member_id=? AND source='self'",
          day,
          reason,
          old.id,
          cid,
          me.id,
        );
        return { id: old.id, updated: true };
      }
      return { id: old.id, alreadyGranted: true };
    }
    const id = uid();
    await run(
      db,
      "INSERT OR IGNORE INTO personal_award_grants(id,course_id,definition_id,member_id,date,reason,granted_by,source,snapshot,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
      id,
      cid,
      definition.id,
      target,
      day,
      reason,
      source === "organizer" ? me.id : null,
      source,
      JSON.stringify(definition),
      now,
    );
    await audit(
      db,
      course,
      me,
      action,
      { id, memberId: target, definitionId: definition.id },
      now,
    );
    return { id };
  }
  if (action === "revokePersonalAward") {
    requireAdmin(me);
    const grant = await one(
      db,
      "SELECT id FROM personal_award_grants WHERE id=? AND course_id=?",
      requiredValue(b.id),
      cid,
    );
    if (!grant) reject(404, "Ocenenie sa nenašlo.");
    await run(
      db,
      "DELETE FROM personal_award_grants WHERE id=? AND course_id=?",
      grant.id,
      cid,
    );
    await audit(db, course, me, action, { id: grant.id }, now);
    return {};
  }
  if (action === "saveMotto") {
    requireAdmin(me);
    const old = b.id
      ? await one(
          db,
          "SELECT id FROM mottos WHERE id=? AND course_id=?",
          requiredValue(b.id),
          cid,
        )
      : null;
    if (b.id && !old) reject(404, "Citát sa nenašiel.");
    const sourceUrl = z.string().url().max(1000).parse(b.sourceUrl);
    if (new URL(sourceUrl).protocol !== "https:")
      reject(400, "Zdroj citátu musí byť HTTPS adresa.");
    const motto: Motto = {
      id: old?.id || uid(),
      text: requiredValue(b.text, 500),
      author: requiredValue(b.author, 150),
      sourceUrl,
      active: z.boolean().parse(b.active),
      order: z.number().int().min(0).max(10000).parse(b.order),
      ...(b.originalText
        ? { originalText: textValue(b.originalText, 1000) }
        : {}),
      ...(b.sourceWork ? { sourceWork: textValue(b.sourceWork, 300) } : {}),
      ...(b.translation !== undefined
        ? { translation: z.boolean().parse(b.translation) }
        : {}),
      ...(b.dateFrom ? { dateFrom: dateValue(b.dateFrom) } : {}),
      ...(b.dateTo ? { dateTo: dateValue(b.dateTo) } : {}),
    };
    if (motto.dateFrom && motto.dateTo && motto.dateFrom > motto.dateTo)
      reject(400, "Koniec platnosti citátu je pred začiatkom.");
    await run(
      db,
      "INSERT INTO mottos(id,course_id,data,active,position) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,active=excluded.active,position=excluded.position",
      motto.id,
      cid,
      JSON.stringify(motto),
      motto.active ? 1 : 0,
      motto.order,
    );
    return { id: motto.id };
  }
  if (action === "deleteMotto") {
    requireAdmin(me);
    await run(
      db,
      "DELETE FROM mottos WHERE id=? AND course_id=?",
      requiredValue(b.id),
      cid,
    );
    return {};
  }
  return null;
}
