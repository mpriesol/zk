import { createHash } from "node:crypto";
import { z } from "zod";
import {
  one,
  rows,
  run,
  uid,
  type Database,
  type Statement,
} from "./database.ts";
import { addDays } from "./dates.ts";
import {
  dateValue,
  reject,
  requireAdmin,
  requiredValue,
  tableExists,
} from "./community.ts";
import type { Course, Member, Rule, Challenge } from "./types.ts";

export interface PreparationHooks {
  beforePreparationStart?: (input: {
    courseId: string;
    previewId: string;
  }) => Promise<{ backupId: string }>;
  afterPreparationStart?: (input: {
    courseId: string;
    previewId: string;
  }) => Promise<void>;
}
type Snapshot = {
  table: string;
  sql: string;
  params: unknown[];
  json: string;
  count: number;
};
interface Plan {
  proposedCourse: Course;
  preserveParticipants: boolean;
  counts: Record<string, number>;
  snapshots: Snapshot[];
  deletes: { table: string; where: string; params: unknown[] }[];
  accountIds: string[];
  fingerprint: string;
  today: string;
}
const CONFIRMATION = "SPUSTIŤ PRÍPRAVU";
const ident = (value: string) => {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(value))
    throw new Error("Invalid schema identifier");
  return `"${value}"`;
};
async function snapshot(
  db: Database,
  table: string,
  where: string,
  params: unknown[],
  selectedFields?: string[],
): Promise<Snapshot | null> {
  if (!(await tableExists(db, table))) return null;
  const columns = await rows(db, `PRAGMA table_info(${ident(table)})`);
  const order =
    columns
      .filter((c) => c.pk)
      .sort((a, b) => a.pk - b.pk)
      .map((c) => ident(c.name))
      .join(",") || columns.map((c) => ident(c.name)).join(",");
  const projected = selectedFields
    ? columns.filter((c) => selectedFields.includes(c.name))
    : columns;
  const fields = projected
    .flatMap((c) => [`'${c.name}'`, ident(c.name)])
    .join(",");
  const sql = `SELECT json_group_array(json_object(${fields})) value FROM (SELECT ${projected.map((c) => ident(c.name)).join(",")} FROM ${ident(table)} WHERE ${where} ORDER BY ${order})`;
  const json = String((await one(db, sql, ...params)).value);
  return { table, sql, params, json, count: JSON.parse(json).length };
}
// A verified real email can still identify an invitation which the person has
// not linked by signing into that course yet. Internal password-only addresses
// and unverified addresses are deliberately ineligible for that linking path.
function membershipReference(hasAccounts: boolean): string {
  return hasAccounts
    ? `(user_id=? OR (user_id IS NULL AND EXISTS(SELECT 1 FROM "user" u WHERE u.id=? AND u."emailVerified"=1 AND lower(u.email) NOT LIKE '%@accounts.cestou-zimy.invalid' AND lower(u.email)=lower(members.email))))`
    : "user_id=?";
}
export function courseMetadata(
  course: Course,
  b: Record<string, unknown>,
): Course {
  const next = { ...course };
  if (b.year !== undefined)
    next.year = z.number().int().min(2020).max(2200).parse(b.year);
  if (b.eventStartDate !== undefined)
    next.eventStartDate = b.eventStartDate
      ? dateValue(b.eventStartDate)
      : undefined;
  if (b.eventEndDate !== undefined)
    next.eventEndDate = b.eventEndDate ? dateValue(b.eventEndDate) : undefined;
  if (
    (next.eventStartDate && !next.eventEndDate) ||
    (!next.eventStartDate && next.eventEndDate)
  )
    reject(400, "Vyplň začiatok aj koniec zimného kurzu.");
  if (
    next.eventStartDate &&
    next.eventEndDate &&
    next.eventStartDate > next.eventEndDate
  )
    reject(400, "Koniec kurzu nesmie byť pred začiatkom.");
  if (b.coldUnlockDay !== undefined)
    next.coldUnlockDay = z
      .number()
      .int()
      .min(8)
      .max(365)
      .parse(b.coldUnlockDay);
  if (b.mottoStartDate !== undefined)
    next.mottoStartDate = b.mottoStartDate
      ? dateValue(b.mottoStartDate)
      : undefined;
  return next;
}
async function makePlan(
  db: Database,
  course: Course,
  me: Member,
  today: string,
  now: string,
  b: Record<string, unknown>,
): Promise<Plan> {
  requireAdmin(me);
  const preserveParticipants = z
    .boolean()
    .parse(b.preserveParticipants ?? false);
  const proposedCourse = courseMetadata(
    {
      ...course,
      name: requiredValue(b.name ?? `Cestou Zimy ${b.year}`, 120),
      startDate: dateValue(b.startDate),
      endDate: dateValue(b.endDate),
      testMode: false,
      preparationStartedAt: now,
    },
    b,
  );
  if (!proposedCourse.year) reject(400, "Vyplň ročník prípravy.");
  if (
    proposedCourse.startDate > proposedCourse.endDate ||
    proposedCourse.endDate < today ||
    proposedCourse.endDate > addDays(proposedCourse.startDate, 730)
  )
    reject(
      400,
      "Vyber platné obdobie prípravy, ktoré ešte neskončilo, najviac na dva roky.",
    );
  const cid = course.id,
    snapshots: Snapshot[] = [],
    deletes: Plan["deletes"] = [],
    counts: Record<string, number> = {};
  const add = async (
    table: string,
    where: string,
    params: unknown[],
    remove = false,
  ) => {
    const s = await snapshot(db, table, where, params);
    if (s) {
      snapshots.push(s);
      if (remove) {
        counts[table] = (counts[table] || 0) + s.count;
        deletes.push({ table, where, params });
      }
    }
  };
  // Capture retained configuration too: a concurrent edit invalidates the preview.
  await add("courses", "id=?", [cid]);
  for (const table of [
    "rules",
    "challenges",
    "activity_types",
    "personal_award_definitions",
    "mottos",
    "members",
  ])
    await add(table, "course_id=?", [cid]);
  await add(
    "comments",
    "activity_id IN (SELECT id FROM activities WHERE course_id=?)",
    [cid],
    true,
  );
  await add(
    "reactions",
    "activity_id IN (SELECT id FROM activities WHERE course_id=?)",
    [cid],
    true,
  );
  await add(
    "recipients",
    "message_id IN (SELECT id FROM messages WHERE course_id=?)",
    [cid],
    true,
  );
  for (const table of [
    "activities",
    "awards",
    "completions",
    "cold_entries",
    "personal_award_grants",
    "outbox",
    "messages",
    "motto_daily",
    "recalculation_previews",
    "registration_invites",
    "password_resets",
    "audit",
  ])
    await add(table, "course_id=?", [cid], true);
  const membershipWhere = preserveParticipants
    ? "course_id=? AND 0"
    : "course_id=? AND id<>?";
  const membershipParams = preserveParticipants ? [cid] : [cid, me.id];
  const removals = await rows(
    db,
    `SELECT id,user_id FROM members WHERE ${membershipWhere}`,
    ...membershipParams,
  );
  counts.removedMemberships = removals.length;
  await add(
    "membership_requests",
    preserveParticipants
      ? "course_id=? AND 0"
      : "course_id=? AND user_id<>COALESCE(?, '')",
    preserveParticipants ? [cid] : [cid, me.userId],
    true,
  );
  await add(
    "subscriptions",
    preserveParticipants ? "course_id=? AND 0" : "course_id=? AND member_id<>?",
    preserveParticipants ? [cid] : [cid, me.id],
    true,
  );
  if (await tableExists(db, "media")) {
    // Template imagery is configuration, not old participant history.
    await add(
      "media",
      preserveParticipants
        ? "course_id=? AND kind='activity'"
        : "course_id=? AND kind<>'award'",
      [cid],
      true,
    );
    counts.retainedTemplateImages = Number(
      (
        await one(
          db,
          "SELECT COUNT(*) count FROM media WHERE course_id=? AND kind='award'",
          cid,
        )
      ).count,
    );
    counts.retainedAvatars = preserveParticipants
      ? Number(
          (
            await one(
              db,
              "SELECT COUNT(*) count FROM media WHERE course_id=? AND kind='avatar'",
              cid,
            )
          ).count,
        )
      : 0;
  }
  const userIds = [
    ...new Set(removals.map((r) => r.user_id).filter(Boolean)),
  ] as string[];
  const accountIds: string[] = [];
  const hasAccounts = await tableExists(db, "user");
  let shared = 0;
  for (const userId of userIds) {
    // Capture only identity fields relevant to linking, never credentials or
    // sessions. Changing the verified email invalidates the same atomic guard.
    const identity = hasAccounts
      ? await snapshot(
          db,
          "user",
          "id=?",
          [userId],
          ["id", "email", "emailVerified"],
        )
      : null;
    if (identity) snapshots.push(identity);
    const where = `${membershipReference(hasAccounts)} AND course_id<>?`,
      params = hasAccounts ? [userId, userId, cid] : [userId, cid];
    // Snapshot both links and not-yet-linked invitations, including absence.
    // A new invitation during backup must also invalidate the deletion batch.
    await add("members", where, params);
    const elsewhere = await one(
      db,
      `SELECT id FROM members WHERE ${where} LIMIT 1`,
      ...params,
    );
    if (elsewhere) {
      shared++;
      continue;
    }
    if (identity?.count) accountIds.push(userId);
  }
  counts.removedAccounts = accountIds.length;
  counts.preservedSharedAccounts = shared;
  // Membership deletion runs after dependent records; acting organizer survives.
  deletes.push({
    table: "members",
    where: membershipWhere,
    params: membershipParams,
  });
  counts.members = removals.length;
  const fingerprint = createHash("sha256")
    .update(
      JSON.stringify({
        today,
        preserveParticipants,
        proposedCourse: { ...proposedCourse, preparationStartedAt: undefined },
        snapshots: snapshots.map((s) => [s.table, s.sql, s.params, s.json]),
        accountIds,
      }),
    )
    .digest("hex");
  return {
    proposedCourse,
    preserveParticipants,
    counts,
    snapshots,
    deletes,
    accountIds,
    fingerprint,
    today,
  };
}
export async function preparationAction(
  db: Database,
  course: Course,
  me: Member,
  today: string,
  now: string,
  action: string,
  b: Record<string, unknown>,
  hooks: PreparationHooks,
): Promise<Record<string, unknown> | null> {
  if (action !== "previewPreparation" && action !== "applyPreparation")
    return null;
  requireAdmin(me);
  if (action === "previewPreparation") {
    const plan = await makePlan(db, course, me, today, now, b),
      previewId = uid(),
      expiresAt = new Date(Date.parse(now) + 600000).toISOString();
    const settings = {
      name: plan.proposedCourse.name,
      year: plan.proposedCourse.year,
      startDate: plan.proposedCourse.startDate,
      endDate: plan.proposedCourse.endDate,
      eventStartDate: plan.proposedCourse.eventStartDate,
      eventEndDate: plan.proposedCourse.eventEndDate,
      coldUnlockDay: plan.proposedCourse.coldUnlockDay,
      preserveParticipants: plan.preserveParticipants,
    };
    await run(
      db,
      "INSERT INTO preparation_previews(id,course_id,member_id,data,fingerprint,expires_at) VALUES(?,?,?,?,?,?)",
      previewId,
      course.id,
      me.id,
      JSON.stringify({ settings, plan }),
      plan.fingerprint,
      expiresAt,
    );
    return {
      previewId,
      expiresAt,
      confirmation: CONFIRMATION,
      counts: plan.counts,
      preserveParticipants: plan.preserveParticipants,
      proposedCourse: plan.proposedCourse,
      backupRequired: true,
      backupAvailable: !!hooks.beforePreparationStart,
      warning:
        "Potvrdením spustenia sa ihneď vymažú všetky doterajšie údaje tejto prípravy uvedené v náhľade, aj keď je začiatok nastavený na budúci dátum. Tvoje prihlásenie zostane. Nastavenia, pravidlá, šablóny ocenení, ich obrázky a knižnica citátov zostanú zachované.",
    };
  }
  const preview = await one(
    db,
    "SELECT * FROM preparation_previews WHERE id=? AND course_id=? AND member_id=?",
    requiredValue(b.previewId),
    course.id,
    me.id,
  );
  if (!preview || preview.expires_at <= now)
    reject(409, "Náhľad vypršal. Vytvor nový náhľad.");
  if (b.confirmation !== CONFIRMATION)
    reject(400, `Potvrď prepísaním textu ${CONFIRMATION}.`);
  const stored = JSON.parse(preview.data),
    plan = await makePlan(db, course, me, today, now, stored.settings);
  if (plan.fingerprint !== preview.fingerprint)
    reject(409, "Údaje alebo dnešný deň sa zmenili. Vytvor nový náhľad.");
  if (!hooks.beforePreparationStart)
    reject(
      503,
      "Spustenie je zablokované: najprv nastav overenú zálohu databázy a fotografií.",
    );
  let backupId: string;
  try {
    backupId = (
      await hooks.beforePreparationStart({
        courseId: course.id,
        previewId: preview.id,
      })
    ).backupId;
    if (!backupId) throw new Error("missing backup");
  } catch {
    reject(
      503,
      "Záloha pred spustením sa nepodarila. Žiadne údaje neboli vymazané.",
    );
  }
  const statements: Statement[] = [];
  // Evaluate every captured SQL snapshot inside the SAME transaction as deletion.
  // CHECK failure rolls the whole batch back even with concurrent external writers.
  const predicates = plan.snapshots.map((s) => `((${s.sql})=?)`);
  const guardParams = plan.snapshots.flatMap((s) => [...s.params, s.json]);
  statements.push(
    db
      .prepare(
        `INSERT INTO preparation_guards(id,valid) SELECT ?,CASE WHEN EXISTS(SELECT 1 FROM preparation_previews WHERE id=? AND course_id=? AND member_id=? AND expires_at>?) AND ${predicates.join(" AND ") || "1"} THEN 1 ELSE 0 END`,
      )
      .bind(preview.id, preview.id, course.id, me.id, now, ...guardParams),
  );
  for (const d of plan.deletes)
    statements.push(
      db
        .prepare(`DELETE FROM ${ident(d.table)} WHERE ${d.where}`)
        .bind(...d.params),
    );
  // Recheck both linked memberships and eligible unlinked invitations inside
  // the deletion transaction before removing any global identity or session.
  const unreferenced = `NOT EXISTS(SELECT 1 FROM members WHERE ${membershipReference(true)})`;
  for (const id of plan.accountIds) {
    for (const [table, column] of [
      ["session", "userId"],
      ["account", "userId"],
      ["operator_password_accounts", "user_id"],
    ]) {
      if (await tableExists(db, table))
        statements.push(
          db
            .prepare(
              `DELETE FROM ${ident(table)} WHERE ${ident(column)}=? AND ${unreferenced}`,
            )
            .bind(id, id, id),
        );
    }
    statements.push(
      db
        .prepare(`DELETE FROM "user" WHERE id=? AND ${unreferenced}`)
        .bind(id, id, id),
    );
  }
  // Keep the latest configured template for each rule and make it applicable to the new preparation.
  const rules = (
    await rows(
      db,
      "SELECT data FROM rules WHERE course_id=? ORDER BY version",
      course.id,
    )
  ).map((r) => JSON.parse(r.data) as Rule);
  const latest = new Map<string, Rule>();
  for (const rule of rules) latest.set(rule.key, rule);
  statements.push(
    db.prepare("DELETE FROM rules WHERE course_id=?").bind(course.id),
  );
  for (const rule of latest.values()) {
    const next = {
      ...rule,
      id: uid(),
      version: 1,
      effectiveFrom: plan.proposedCourse.startDate,
    };
    statements.push(
      db
        .prepare(
          "INSERT INTO rules(id,course_id,key,version,effective_from,data) VALUES(?,?,?,?,?,?)",
        )
        .bind(
          next.id,
          course.id,
          next.key,
          next.version,
          next.effectiveFrom,
          JSON.stringify(next),
        ),
    );
  }
  for (const row of await rows(
    db,
    "SELECT data FROM challenges WHERE course_id=?",
    course.id,
  )) {
    const ch: Challenge = JSON.parse(row.data);
    ch.status = "draft";
    ch.publishedAt = null;
    ch.startDate = plan.proposedCourse.startDate;
    ch.endDate = plan.proposedCourse.endDate;
    statements.push(
      db
        .prepare(
          "UPDATE challenges SET data=?,status='draft' WHERE id=? AND course_id=?",
        )
        .bind(JSON.stringify(ch), ch.id, course.id),
    );
    if (ch.typeId)
      statements.push(
        db
          .prepare(
            "UPDATE activity_types SET hidden=1 WHERE id=? AND course_id=?",
          )
          .bind(ch.typeId, course.id),
      );
  }
  statements.push(
    db
      .prepare("UPDATE courses SET data=? WHERE id=?")
      .bind(JSON.stringify(plan.proposedCourse), course.id),
  );
  statements.push(
    db
      .prepare("DELETE FROM preparation_previews WHERE course_id=?")
      .bind(course.id),
  );
  statements.push(
    db
      .prepare(
        "INSERT INTO audit(id,course_id,member_id,action,details,created_at) VALUES(?,?,?,?,?,?)",
      )
      .bind(
        uid(),
        course.id,
        me.id,
        "startPreparation",
        JSON.stringify({
          counts: plan.counts,
          backupId,
          preserveParticipants: plan.preserveParticipants,
          startDate: plan.proposedCourse.startDate,
          endDate: plan.proposedCourse.endDate,
          year: plan.proposedCourse.year,
        }),
        now,
      ),
  );
  statements.push(
    db.prepare("DELETE FROM preparation_guards WHERE id=?").bind(preview.id),
  );
  try {
    await db.batch(statements);
  } catch (error) {
    if (
      error instanceof Error &&
      /CHECK constraint|UNIQUE constraint.*preparation_guards/.test(
        error.message,
      )
    )
      reject(
        409,
        "Údaje sa počas potvrdenia zmenili. Nič sa nevymazalo; vytvor nový náhľad.",
      );
    throw error;
  }
  let cleanupPending = false;
  if (hooks.afterPreparationStart) {
    try {
      await hooks.afterPreparationStart({
        courseId: course.id,
        previewId: preview.id,
      });
    } catch {
      cleanupPending = true;
    }
  }
  return {
    started: true,
    course: plan.proposedCourse,
    counts: plan.counts,
    backupId,
    cleanupPending,
  };
}
