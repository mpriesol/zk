import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, copyFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SQLiteDatabase, migrateApp } from "../server/sqlite.ts";
import { handleRequest, type ServerConfig } from "../lib/server.ts";
import {
  createAuth,
  migrateAuth,
  authSettingsFromEnv,
} from "../server/auth.ts";
import { createInitialPasswordAdmin } from "../server/accounts.ts";
import { createApiHandler } from "../server/start.ts";
import type { Identity, Course } from "../lib/types.ts";

const origin = "https://hub.example.test",
  appUrl = origin + "/zk";
const admin: Identity = {
  userId: "admin",
  email: "admin@example.test",
  displayName: "Organizátor",
};
const alice: Identity = {
  userId: "alice",
  email: "alice@example.test",
  displayName: "Alica",
};
async function fixture(t: test.TestContext) {
  const db = new SQLiteDatabase();
  migrateApp(db);
  t.after(() => db.close());
  let clock = new Date("2026-11-22T12:00:00Z");
  const cfg: ServerConfig = {
    courseId: "season-test",
    bootstrapAdminEmail: admin.email,
    siteUrl: appUrl,
    now: () => clock,
  };
  const req = (who: Identity | null, path = "/api/state", body?: unknown) =>
    handleRequest(
      new Request(origin + path, {
        method: body === undefined ? "GET" : "POST",
        headers:
          body === undefined
            ? {}
            : { "content-type": "application/json", origin },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
      who,
      db,
      cfg,
    );
  async function ok(who: Identity | null, path = "/api/state", body?: unknown) {
    const res = await req(who, path, body);
    const data: any = await res.json();
    assert.equal(res.status, 200, JSON.stringify(data));
    return data;
  }
  const call = (
    who: Identity,
    action: string,
    values: Record<string, unknown> = {},
  ) => ok(who, "/api/action", { action, ...values });
  const state = await ok(admin);
  await call(admin, "saveCourse", {
    ...state.course,
    name: "Cestou Zimy 2027",
    startDate: "2026-11-16",
    endDate: "2027-01-31",
    year: 2027,
    eventStartDate: "2027-02-03",
    eventEndDate: "2027-02-07",
    coldUnlockDay: 8,
  });
  await call(admin, "inviteMember", {
    email: alice.email,
    nickname: "Alica",
    role: "participant",
  });
  const as = await ok(alice);
  const count = (table: string, where = "1=1", ...values: any[]) =>
    Number(
      db.native
        .prepare(`SELECT COUNT(*) n FROM ${table} WHERE ${where}`)
        .get(...values)!.n,
    );
  return {
    db,
    cfg,
    req,
    ok,
    call,
    count,
    aliceId: as.me.id,
    adminId: state.me.id,
    setDate: (date: string) => {
      clock = new Date(date + "T12:00:00Z");
    },
    activity: async (who = alice) =>
      call(who, "saveActivity", {
        idempotencyKey: crypto.randomUUID(),
        date: "2026-11-20",
        typeId: "season-test-walk",
        minutes: 35,
        distance: null,
        note: "Test prípravy",
      }),
    preview: (extra: Record<string, unknown> = {}) =>
      call(admin, "previewPreparation", {
        year: 2028,
        name: "Cestou Zimy 2028",
        startDate: "2027-11-01",
        endDate: "2028-01-31",
        eventStartDate: "2028-02-02",
        eventEndDate: "2028-02-06",
        ...extra,
      }),
  };
}

test("cold days require publication and day eight, deduplicate people-days, never award movement", async (t) => {
  const f = await fixture(t);
  let state = await f.ok(alice);
  assert.equal(state.cold, null);
  assert.ok(!JSON.stringify(state).includes("Studená sprcha"));
  await f.call(admin, "publishChallenge", {
    id: "season-test-cold",
    announce: true,
  });
  state = await f.ok(alice);
  assert.equal(state.cold, null);
  assert.ok(
    !JSON.stringify(state).includes("Studená sprcha"),
    "a scheduled announcement must not leak the cold challenge before day eight",
  );
  let response = await f.req(alice, "/api/action", {
    action: "saveColdEntry",
    date: "2026-11-22",
    kind: "shower",
  });
  assert.equal(response.status, 404);
  f.setDate("2026-11-23");
  response = await f.req(alice, "/api/action", {
    action: "saveColdEntry",
    date: "2026-11-22",
    kind: "shower",
  });
  assert.equal(response.status, 400);
  response = await f.req(alice, "/api/action", {
    action: "saveColdEntry",
    date: "2026-11-24",
    kind: "shower",
  });
  assert.equal(response.status, 400);
  const saved = await f.call(alice, "saveColdEntry", {
    date: "2026-11-23",
    kind: "shower",
    note: "súkromná poznámka",
  });
  await f.call(alice, "saveColdEntry", {
    date: "2026-11-23",
    kind: "outdoor",
    note: "súkromná poznámka",
  });
  state = await f.ok(alice);
  assert.equal(state.cold.entries.length, 1);
  assert.equal(state.cold.entryDays, 1);
  assert.equal(state.cold.people, 1);
  assert.equal(state.cold.daily[0].people, 1);
  assert.equal(state.summary.activities, 0);
  assert.equal(state.summary.movementDays, 0);
  assert.equal(state.awards.length, 0);
  const other = await f.ok(admin);
  assert.equal(other.cold.entries.length, 0);
  assert.equal(other.cold.calendar[0].memberId, f.aliceId);
  assert.ok(!JSON.stringify(other.cold).includes("súkromná poznámka"));
  await f.call(alice, "deleteColdEntry", { id: saved.id });
  assert.equal((await f.ok(alice)).cold.entryDays, 0);
});

test("old completeChallenge cannot bypass cold date gate and admin reporting is private", async (t) => {
  const f = await fixture(t);
  await f.call(admin, "publishChallenge", { id: "season-test-cold" });
  const bad = await f.req(alice, "/api/action", {
    action: "completeChallenge",
    id: "season-test-cold",
    date: "2026-11-20",
    completed: true,
  });
  assert.equal(bad.status, 400);
  assert.equal(f.count("cold_entries"), 0);
  assert.equal((await f.req(alice, "/api/admin")).status, 403);
  await f.activity();
  const report = await f.ok(admin, "/api/admin");
  assert.equal(report.reporting.activities.length, 1);
  assert.equal(report.reporting.activities[0].memberId, f.aliceId);
});

test("ended cold challenges allow backdated entries only inside their closed window", async (t) => {
  const f = await fixture(t);
  await f.call(admin, "publishChallenge", { id: "season-test-cold" });
  f.setDate("2026-11-24");
  await f.call(admin, "endChallenge", { id: "season-test-cold" });
  f.setDate("2026-11-26");
  const state = await f.ok(alice);
  assert.equal(state.cold.canRecord, true);
  assert.equal(state.cold.availableFrom, "2026-11-23");
  assert.equal(state.cold.endDate, "2026-11-24");
  const entry = await f.call(alice, "saveColdEntry", {
    date: "2026-11-24",
    kind: "shower",
  });
  assert.equal(
    (
      await f.req(alice, "/api/action", {
        action: "saveColdEntry",
        date: "2026-11-25",
        kind: "shower",
      })
    ).status,
    400,
  );
  await f.call(alice, "deleteColdEntry", { id: entry.id });
  assert.equal((await f.ok(alice)).cold.entryDays, 0);
});

test("cold challenges ended before unlocking have no recordable dates", async (t) => {
  const f = await fixture(t);
  await f.call(admin, "publishChallenge", { id: "season-test-cold" });
  await f.call(admin, "endChallenge", { id: "season-test-cold" });
  f.setDate("2026-11-23");
  const state = await f.ok(alice);
  assert.equal(state.cold.canRecord, false);
  assert.ok(state.cold.endDate < state.cold.availableFrom);
  assert.equal(
    (
      await f.req(alice, "/api/action", {
        action: "saveColdEntry",
        date: "2026-11-23",
        kind: "shower",
      })
    ).status,
    400,
  );
  assert.equal(f.count("cold_entries"), 0);
});

test("personal awards distinguish organizer grants and self confirmation without push", async (t) => {
  const f = await fixture(t);
  const defs = (await f.ok(admin, "/api/admin")).personalAwardDefinitions;
  assert.equal(defs.length, 13);
  assert.ok(defs.every((d: any) => d.status === "draft"));
  assert.equal((await f.ok(alice)).personalAwardDefinitions.length, 0);
  const self = defs.find((d: any) => d.mode === "self"),
    manual = defs.find((d: any) => d.mode === "organizer");
  for (const def of [self, manual])
    await f.call(admin, "saveAwardDefinition", { ...def, status: "published" });
  const before = f.count("outbox");
  const own = await f.call(alice, "confirmPersonalAward", {
    definitionId: self.id,
    date: "2026-11-22",
  });
  const again = await f.call(alice, "confirmPersonalAward", {
    definitionId: self.id,
    date: "2026-11-22",
  });
  assert.equal(again.id, own.id);
  assert.equal(f.count("personal_award_grants"), 1);
  await f.call(alice, "confirmPersonalAward", {
    definitionId: self.id,
    date: "2026-11-20",
    reason: "Doplnený príbeh",
  });
  const edited = (await f.ok(alice)).personalAwards.find(
    (g: any) => g.id === own.id,
  );
  assert.equal(edited.date, "2026-11-20");
  assert.equal(edited.reason, "Doplnený príbeh");

  assert.equal(
    (
      await f.req(alice, "/api/action", {
        action: "confirmPersonalAward",
        definitionId: manual.id,
        date: "2026-11-22",
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await f.req(alice, "/api/action", {
        action: "grantPersonalAward",
        definitionId: manual.id,
        memberId: f.aliceId,
        date: "2026-11-22",
        reason: "Pomoc",
      })
    ).status,
    403,
  );
  await f.call(admin, "grantPersonalAward", {
    definitionId: manual.id,
    memberId: f.aliceId,
    date: "2026-11-22",
    reason: "Pomoc skupine pri príprave.",
  });
  const grants = (await f.ok(alice)).personalAwards;
  assert.equal(grants.length, 2);
  assert.equal(
    grants.find((g: any) => g.definitionId === manual.id).source,
    "organizer",
  );
  await f.call(alice, "confirmPersonalAward", {
    definitionId: self.id,
    completed: false,
  });
  assert.equal(f.count("personal_award_grants"), 1);
  assert.equal(f.count("outbox"), before);
});

test("archive is personal, records acknowledgement and never changes other recipients", async (t) => {
  const f = await fixture(t);
  const message = await f.call(admin, "saveMessage", {
    title: "Zoznam",
    body: "Čo pripraviť",
    link: "",
    important: true,
    pinned: true,
    audience: "all",
    recipients: [],
    push: false,
  });
  await f.call(admin, "sendMessage", { id: message.id });
  await f.call(alice, "archiveMessage", { id: message.id });
  const mine = (await f.ok(alice)).messages.find(
      (m: any) => m.id === message.id,
    ),
    other = (await f.ok(admin)).messages.find((m: any) => m.id === message.id);
  assert.ok(mine.archivedAt && mine.readAt && mine.acknowledgedAt);
  assert.equal(other.archivedAt, null);
  await f.call(alice, "archiveMessage", { id: message.id, archived: false });
  assert.equal((await f.ok(alice)).messages[0].archivedAt, null);
  assert.equal(f.count("messages"), 1);
});

test("server freezes the daily motto and admin ordering does not randomize the current day", async (t) => {
  const f = await fixture(t);
  const first = (await f.ok(alice)).motto;
  assert.ok(first && first.sourceUrl && first.author);
  const all = (await f.ok(admin, "/api/admin")).mottos;
  assert.ok(all.length >= 7);
  await f.call(admin, "saveMotto", { ...all.at(-1), order: 0 });
  assert.deepEqual((await f.ok(alice)).motto, first);
  const count = f.count("mottos");
  await f.call(admin, "deleteMotto", {
    id: all.find((m: any) => m.id !== first.id).id,
  });
  await f.ok(admin);
  assert.equal(
    f.count("mottos"),
    count - 1,
    "seeding is one time, not replenishing intentionally removed quotes",
  );
});

test("preparation preview is harmless, requires exact confirmation and a successful backup", async (t) => {
  const f = await fixture(t);
  await f.activity();
  const preview = await f.preview();
  assert.equal(preview.counts.activities, 1);
  assert.equal(preview.counts.removedMemberships, 1);
  assert.equal(f.count("activities"), 1);
  let res = await f.req(admin, "/api/action", {
    action: "applyPreparation",
    previewId: preview.previewId,
    confirmation: "yes",
  });
  assert.equal(res.status, 400);
  res = await f.req(admin, "/api/action", {
    action: "applyPreparation",
    previewId: preview.previewId,
    confirmation: preview.confirmation,
  });
  assert.equal(res.status, 503);
  assert.equal(f.count("activities"), 1);
  f.cfg.beforePreparationStart = async () => {
    throw new Error("disk unavailable");
  };
  res = await f.req(admin, "/api/action", {
    action: "applyPreparation",
    previewId: preview.previewId,
    confirmation: preview.confirmation,
  });
  assert.equal(res.status, 503);
  assert.equal(f.count("activities"), 1);
});

test("changed, expired or cross-user preparation previews never delete data", async (t) => {
  const f = await fixture(t);
  await f.activity();
  f.cfg.beforePreparationStart = async () => ({
    backupId: "verified-test-snapshot",
  });
  let preview = await f.preview();
  await f.activity();
  let res = await f.req(admin, "/api/action", {
    action: "applyPreparation",
    previewId: preview.previewId,
    confirmation: preview.confirmation,
  });
  assert.equal(res.status, 409);
  assert.equal(f.count("activities"), 2);
  preview = await f.preview();
  res = await f.req(alice, "/api/action", {
    action: "applyPreparation",
    previewId: preview.previewId,
    confirmation: preview.confirmation,
  });
  assert.equal(res.status, 403);
  f.setDate("2026-11-23");
  res = await f.req(admin, "/api/action", {
    action: "applyPreparation",
    previewId: preview.previewId,
    confirmation: preview.confirmation,
  });
  assert.equal(res.status, 409);
  assert.equal(f.count("activities"), 2);
});

test("atomic guard catches data added during snapshot backup and rolls everything back", async (t) => {
  const f = await fixture(t);
  await f.activity();
  const preview = await f.preview();
  f.cfg.beforePreparationStart = async () => {
    f.db.native
      .prepare("UPDATE activities SET note=? WHERE course_id=?")
      .run("A concurrent edit", "season-test");
    return { backupId: "verified-test-snapshot" };
  };
  const res = await f.req(admin, "/api/action", {
    action: "applyPreparation",
    previewId: preview.previewId,
    confirmation: preview.confirmation,
  });
  assert.equal(res.status, 409);
  assert.equal(f.count("activities"), 1);
  assert.equal(f.count("members"), 2);
  assert.equal(f.count("preparation_guards"), 0);
});

test("explicit preparation clears course history, preserves templates and organizer, and gates future entries", async (t) => {
  const f = await fixture(t);
  await f.activity();
  const rules = f.count("rules"),
    defs = f.count("personal_award_definitions"),
    quotes = f.count("mottos");
  f.db.native
    .prepare(
      "INSERT INTO media(id,course_id,member_id,kind,resource_id,storage_name,mime_type,bytes,width,height,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
    )
    .run(
      "template",
      "season-test",
      f.adminId,
      "award",
      "regularity",
      "template.webp",
      "image/webp",
      1,
      1,
      1,
      "2026-11-20",
    );
  f.db.native
    .prepare(
      "INSERT INTO media(id,course_id,member_id,kind,resource_id,storage_name,mime_type,bytes,width,height,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
    )
    .run(
      "photo",
      "season-test",
      f.aliceId,
      "activity",
      "old-act",
      "photo.webp",
      "image/webp",
      1,
      1,
      1,
      "2026-11-20",
    );
  let cleaned = false;
  f.cfg.beforePreparationStart = async () => ({
    backupId: "verified-test-snapshot",
  });
  f.cfg.afterPreparationStart = async () => {
    assert.equal(f.count("activities"), 0);
    cleaned = true;
  };
  const preview = await f.preview();
  assert.equal(preview.counts.media, 1);
  assert.equal(preview.counts.retainedTemplateImages, 1);
  const result = await f.call(admin, "applyPreparation", {
    previewId: preview.previewId,
    confirmation: preview.confirmation,
  });
  assert.equal(result.started, true);
  assert.ok(cleaned);
  assert.equal(f.count("activities"), 0);
  assert.equal(f.count("members"), 1);
  assert.equal(f.count("rules"), rules);
  assert.equal(f.count("personal_award_definitions"), defs);
  assert.equal(f.count("mottos"), quotes);
  assert.equal(f.count("media"), 1);
  assert.equal(f.count("preparation_previews"), 0);
  const state = await f.ok(admin);
  assert.equal(state.course.year, 2028);
  assert.equal(state.course.startDate, "2027-11-01");
  assert.equal(state.course.testMode, false);
  assert.equal(state.me.id, f.adminId);
  assert.equal(state.cold, null);
  const res = await f.req(admin, "/api/action", {
    action: "saveActivity",
    typeId: "season-test-walk",
    date: "2027-11-01",
    minutes: 30,
    idempotencyKey: "future",
  });
  assert.equal(res.status, 400);
  assert.equal((await f.req(alice)).status, 403);
  assert.equal(
    (
      await f.req(admin, "/api/action", {
        action: "applyPreparation",
        previewId: preview.previewId,
        confirmation: preview.confirmation,
      })
    ).status,
    409,
  );
});

test("preserve-participants option keeps memberships and avatars but clears their training", async (t) => {
  const f = await fixture(t);
  await f.activity();
  f.cfg.beforePreparationStart = async () => ({
    backupId: "verified-test-snapshot",
  });
  const preview = await f.preview({ preserveParticipants: true });
  assert.equal(preview.counts.removedMemberships, 0);
  await f.call(admin, "applyPreparation", {
    previewId: preview.previewId,
    confirmation: preview.confirmation,
  });
  assert.equal(f.count("activities"), 0);
  assert.equal(f.count("members"), 2);
  assert.equal((await f.req(alice)).status, 200);
});

test("metadata migration preserves prep dates, accounts and legacy cold history", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "zk-migration-"));
  const db = new SQLiteDatabase();
  t.after(() => {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  });
  for (const file of [
    "0000_certain_nightmare.sql",
    "0001_wandering_thanos.sql",
    "0002_far_xorn.sql",
  ])
    copyFileSync(
      new URL("../drizzle/" + file, import.meta.url),
      join(directory, file),
    );
  migrateApp(db, directory);
  const course: Course = {
    id: "old",
    name: "Cestou Zimy · testovací ročník",
    startDate: "2026-10-01",
    endDate: "2027-01-30",
    timezone: "Europe/Bratislava",
    squirrelLimit: 2,
    testMode: true,
  };
  db.native
    .prepare("INSERT INTO courses VALUES(?,?)")
    .run("old", JSON.stringify(course));
  db.native
    .prepare(
      "INSERT INTO members(id,course_id,user_id,email,nickname,role,active,animations,joined_at) VALUES('m','old','u','u@example.test','U','participant',1,1,'2026-10-01')",
    )
    .run();
  db.native
    .prepare(
      "INSERT INTO activity_types(id,course_id,name,group_name,hidden,active,challenge_id) VALUES('old-cold','old','Studená sprcha','task',1,1,'old-cold')",
    )
    .run();
  db.native
    .prepare(
      "INSERT INTO challenges(id,course_id,data,status,hidden) VALUES('old-cold','old',?,'draft',1)",
    )
    .run(
      JSON.stringify({
        id: "old-cold",
        name: "Studená sprcha",
        status: "draft",
        hidden: true,
      }),
    );
  db.native
    .prepare(
      "INSERT INTO completions VALUES('c','old','m','old-cold','2026-10-03','legacy','2026-10-03')",
    )
    .run();
  db.native
    .prepare(
      "INSERT INTO activities VALUES('a','old','m','old-cold','2026-10-03',null,null,'legacy','2026-10-03','2026-10-03','legacy-key')",
    )
    .run();
  migrateApp(db);
  const next = JSON.parse(
    String(
      db.native.prepare("SELECT data FROM courses WHERE id='old'").get()!.data,
    ),
  );
  assert.equal(next.name, "Cestou Zimy 2027");
  assert.equal(next.startDate, course.startDate);
  assert.equal(next.endDate, course.endDate);
  assert.equal(next.testMode, true);
  assert.equal(
    db.native.prepare("SELECT COUNT(*) n FROM cold_entries").get()!.n,
    1,
  );
  assert.equal(
    db.native.prepare("SELECT COUNT(*) n FROM activities").get()!.n,
    1,
  );
  assert.equal(db.native.prepare("SELECT COUNT(*) n FROM members").get()!.n, 1);
  assert.equal(
    db.native.prepare("SELECT hidden FROM challenges").get()!.hidden,
    1,
  );
});

test("real Better Auth preserves organizer and linked or email-invited identities while removing exclusive accounts", async (t) => {
  const db = new SQLiteDatabase();
  migrateApp(db);
  t.after(() => db.close());
  const settings = authSettingsFromEnv({
    NODE_ENV: "production",
    APP_URL: appUrl,
    COURSE_ID: "auth-season",
    AUTH_MODE: "password",
    BETTER_AUTH_SECRET:
      "isolated-test-only-preparation-secret-01234567890123456789",
    REGISTRATION_OPEN: "true",
  });
  const auth = createAuth(db, settings);
  await migrateAuth(auth);
  const password = "Only test password 21!";
  await createInitialPasswordAdmin(db, auth, settings, {
    username: "organizer",
    password,
  });
  const config: ServerConfig = {
    courseId: "auth-season",
    siteUrl: appUrl,
    now: () => new Date("2026-11-22T12:00:00Z"),
    beforePreparationStart: async () => ({
      backupId: "isolated-verified-snapshot",
    }),
  };
  const api = createApiHandler(db, auth, config);
  let ip = 1;
  const request = (path: string, body?: unknown, cookie = "") =>
    api(
      new Request(appUrl + path, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          origin,
          "content-type": "application/json",
          cookie,
          "x-real-ip": `192.0.2.${ip++}`,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    );
  async function data(response: Response) {
    const result: any = await response.json();
    assert.ok(response.ok, JSON.stringify(result));
    return result;
  }
  const cookies = (response: Response) =>
    response.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; ");
  const adminLogin = await request("/api/auth/sign-in/username", {
    username: "organizer",
    password,
  });
  assert.equal(adminLogin.status, 200);
  const adminCookie = cookies(adminLogin);
  const adminState = await data(
    await request("/api/state", undefined, adminCookie),
  );
  await data(
    await request(
      "/api/action",
      {
        action: "saveCourse",
        ...adminState.course,
        year: 2027,
        startDate: "2026-11-16",
        endDate: "2027-01-31",
      },
      adminCookie,
    ),
  );
  async function participant(username: string) {
    const response = await request("/api/register", { username, password });
    await data(response.clone());
    const cookie = cookies(response);
    const pending = (
      await data(
        await request("/api/registration/admin", undefined, adminCookie),
      )
    ).pending.find((p: any) => p.username === username);
    assert.ok(pending);
    await data(
      await request(
        "/api/registration/admin",
        { action: "approve", id: pending.id },
        adminCookie,
      ),
    );
    const state = await data(await request("/api/state", undefined, cookie));
    return { cookie, userId: pending.userId, memberId: state.me.id };
  }
  const exclusive = await participant("exclusive_user"),
    shared = await participant("shared_user"),
    invited = await participant("invited_user");
  db.native
    .prepare("INSERT INTO courses(id,data) VALUES('other-course',?)")
    .run(JSON.stringify({ ...adminState.course, id: "other-course" }));
  const sharedMember = db.native
    .prepare("SELECT * FROM members WHERE id=?")
    .get(shared.memberId)!;
  db.native
    .prepare(
      "INSERT INTO members(id,course_id,user_id,email,nickname,role,active,animations,joined_at) VALUES('other-member','other-course',?,?,'Shared','participant',1,1,?)",
    )
    .run(shared.userId, sharedMember.email, "2026-11-22");
  db.native
    .prepare('UPDATE "user" SET email=?,emailVerified=1 WHERE id=?')
    .run("invited@example.test", invited.userId);
  db.native
    .prepare("UPDATE members SET email=? WHERE id=?")
    .run("invited@example.test", invited.memberId);
  db.native
    .prepare(
      "INSERT INTO members(id,course_id,user_id,email,nickname,role,active,animations,joined_at) VALUES('invited-other-member','other-course',NULL,'invited@example.test','Invited','participant',1,1,'2026-11-22')",
    )
    .run();
  const preview = await data(
    await request(
      "/api/action",
      {
        action: "previewPreparation",
        year: 2027,
        name: "Cestou Zimy 2027",
        startDate: "2026-12-01",
        endDate: "2027-01-31",
        eventStartDate: "2027-02-03",
        eventEndDate: "2027-02-07",
        preserveParticipants: false,
      },
      adminCookie,
    ),
  );
  assert.equal(preview.counts.removedAccounts, 1);
  assert.equal(preview.counts.preservedSharedAccounts, 2);
  await data(
    await request(
      "/api/action",
      {
        action: "applyPreparation",
        previewId: preview.previewId,
        confirmation: preview.confirmation,
      },
      adminCookie,
    ),
  );
  assert.equal(
    (await request("/api/state", undefined, adminCookie)).status,
    200,
  );
  assert.equal(
    (await request("/api/account", undefined, exclusive.cookie)).status,
    401,
  );
  assert.equal(
    db.native.prepare('SELECT id FROM "user" WHERE id=?').get(exclusive.userId),
    undefined,
  );
  assert.ok(
    db.native.prepare('SELECT id FROM "user" WHERE id=?').get(shared.userId),
  );
  assert.ok(
    db.native
      .prepare('SELECT id FROM "session" WHERE userId=?')
      .get(shared.userId),
  );
  assert.ok(
    db.native.prepare("SELECT id FROM members WHERE id='other-member'").get(),
  );
  assert.equal(
    (await request("/api/state", undefined, shared.cookie)).status,
    403,
  );
  assert.ok(
    db.native.prepare('SELECT id FROM "user" WHERE id=?').get(invited.userId),
  );
  assert.ok(
    db.native
      .prepare('SELECT id FROM "session" WHERE userId=?')
      .get(invited.userId),
  );
  assert.ok(
    db.native
      .prepare('SELECT id FROM "account" WHERE userId=?')
      .get(invited.userId),
  );
  assert.equal(
    db.native
      .prepare("SELECT user_id FROM members WHERE id='invited-other-member'")
      .get()!.user_id,
    null,
  );
  const otherCourseApi = createApiHandler(
    db,
    createAuth(db, { ...settings, courseId: "other-course" }),
    { ...config, courseId: "other-course" },
  );
  const invitedState = await data(
    await otherCourseApi(
      new Request(appUrl + "/api/state", {
        headers: { cookie: invited.cookie },
      }),
    ),
  );
  assert.equal(invitedState.me.id, "invited-other-member");
  assert.equal(
    db.native
      .prepare("SELECT user_id FROM members WHERE id='invited-other-member'")
      .get()!.user_id,
    invited.userId,
  );
});

test("preparation fingerprint and atomic guard protect newly unlinked email invitations and verification changes", async (t) => {
  const f = await fixture(t);
  const settings = authSettingsFromEnv({
    NODE_ENV: "production",
    APP_URL: appUrl,
    COURSE_ID: "season-test",
    AUTH_MODE: "password",
    BETTER_AUTH_SECRET:
      "isolated-test-only-email-invitation-01234567890123456789",
  });
  await migrateAuth(createAuth(f.db, settings));
  f.db.native
    .prepare(
      'INSERT INTO "user"(id,name,email,emailVerified,createdAt,updatedAt) VALUES(?,?,?,1,?,?)',
    )
    .run(alice.userId, "Alica", alice.email, Date.now(), Date.now());
  const course = (await f.ok(admin)).course;
  f.db.native
    .prepare("INSERT INTO courses VALUES('invited-course',?)")
    .run(JSON.stringify({ ...course, id: "invited-course" }));
  await f.activity();
  const addInvitation = () =>
    f.db.native
      .prepare(
        "INSERT INTO members(id,course_id,user_id,email,nickname,role,active,animations,joined_at) VALUES('email-invitation','invited-course',NULL,?,'Alica','participant',1,1,'2026-11-22')",
      )
      .run(alice.email);
  const apply = (preview: any) =>
    f.req(admin, "/api/action", {
      action: "applyPreparation",
      previewId: preview.previewId,
      confirmation: preview.confirmation,
    });
  let backups = 0;
  f.cfg.beforePreparationStart = async () => {
    backups++;
    return { backupId: "isolated-test-snapshot" };
  };
  let preview = await f.preview();
  assert.equal(preview.counts.removedAccounts, 1);
  addInvitation();
  assert.equal((await apply(preview)).status, 409);
  assert.equal(
    backups,
    0,
    "a changed invitation must invalidate the preview before backup",
  );
  assert.equal(f.count('"user"'), 1);
  assert.equal(f.count("activities"), 1);

  f.db.native.prepare("DELETE FROM members WHERE id='email-invitation'").run();
  preview = await f.preview();
  f.cfg.beforePreparationStart = async () => {
    addInvitation();
    return { backupId: "isolated-test-snapshot" };
  };
  assert.equal((await apply(preview)).status, 409);
  assert.equal(f.count('"user"'), 1);
  assert.equal(f.count("activities"), 1);
  assert.equal(f.count("members", "course_id='season-test'"), 2);
  assert.equal(f.count("preparation_guards"), 0);

  f.db.native
    .prepare('UPDATE "user" SET emailVerified=0 WHERE id=?')
    .run(alice.userId);
  preview = await f.preview();
  assert.equal(
    preview.counts.removedAccounts,
    1,
    "an unverified address cannot link a membership",
  );
  f.cfg.beforePreparationStart = async () => {
    f.db.native
      .prepare('UPDATE "user" SET emailVerified=1 WHERE id=?')
      .run(alice.userId);
    return { backupId: "isolated-test-snapshot" };
  };
  assert.equal((await apply(preview)).status, 409);
  assert.equal(f.count('"user"'), 1);
  assert.equal(f.count("activities"), 1);
  assert.equal(f.count("preparation_guards"), 0);
  const updated = await f.preview();
  assert.equal(updated.counts.removedAccounts, 0);
  assert.equal(updated.counts.preservedSharedAccounts, 1);
});
