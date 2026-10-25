import test from "node:test";
import assert from "node:assert/strict";
import { handleRequest, type ServerConfig } from "../lib/server.ts";
import { TestDatabase } from "./helpers.ts";
import type { AppState, Identity } from "../lib/types.ts";

const origin = "https://cestou-zimy.example";
const admin: Identity = {
  userId: "account-admin",
  email: "admin@example.test",
  displayName: "Organizátor",
};
const alice: Identity = {
  userId: "account-alice",
  email: "alice@example.test",
  displayName: "Alica",
};
const bob: Identity = {
  userId: "account-bob",
  email: "bob@example.test",
  displayName: "Boris",
};
const stranger: Identity = {
  userId: "account-stranger",
  email: "stranger@example.test",
  displayName: "Cudzí",
};

async function fixture(t: test.TestContext) {
  const db = new TestDatabase();
  t.after(() => db.close());
  let clock = new Date("2026-10-25T12:00:00Z");
  const config: ServerConfig = {
    bootstrapAdminEmail: admin.email,
    now: () => clock,
    siteUrl: origin,
  };
  async function request(
    identity: Identity | null,
    path = "/api/state",
    body?: unknown,
    requestOrigin = origin,
  ) {
    return handleRequest(
      new Request(`${origin}${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers:
          body === undefined
            ? {}
            : { "content-type": "application/json", origin: requestOrigin },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
      identity,
      db,
      config,
    );
  }
  async function ok(
    identity: Identity | null,
    path = "/api/state",
    body?: unknown,
  ) {
    const response = await request(identity, path, body);
    const data = (await response.json()) as any;
    assert.equal(response.status, 200, JSON.stringify(data));
    return data;
  }
  const call = (
    identity: Identity,
    action: string,
    values: Record<string, unknown> = {},
  ) => ok(identity, "/api/action", { action, ...values });
  let state: AppState = await ok(admin);
  await call(admin, "saveCourse", {
    ...state.course,
    name: "TESTOVACÍ ROČNÍK",
    startDate: "2026-09-28",
    endDate: "2026-12-31",
    timezone: "Europe/Bratislava",
    testMode: true,
  });
  for (const identity of [alice, bob]) {
    await call(admin, "inviteMember", {
      email: identity.email,
      nickname: identity.displayName,
      role: "participant",
    });
    await ok(identity);
  }
  const getState = (identity: Identity) => ok(identity) as Promise<AppState>;
  state = await getState(admin);
  const foot = state.types.find((type) => type.group === "foot")!;
  const exercise = state.types.find((type) => type.group === "exercise")!;
  assert.ok(foot);
  assert.ok(exercise);
  async function activity(
    identity: Identity,
    values: Record<string, unknown> = {},
  ) {
    const key = crypto.randomUUID();
    const note = `TEST-${key}`;
    await call(identity, "saveActivity", {
      idempotencyKey: key,
      typeId: foot.id,
      date: "2026-10-20",
      minutes: 35,
      distance: null,
      note,
      ...values,
    });
    return (await getState(identity)).activities.find(
      (item) => item.note === (values.note ?? note),
    )!;
  }
  return {
    db,
    config,
    request,
    ok,
    call,
    getState,
    activity,
    foot,
    exercise,
    setNow: (date: string) => {
      clock = new Date(date);
    },
  };
}

test("invited users authenticate; anonymous and unknown accounts receive no course data", async (t) => {
  const f = await fixture(t);
  assert.equal((await f.getState(alice)).me.nickname, "Alica");
  for (const identity of [null, stranger]) {
    const response = await f.request(identity);
    assert.ok([401, 403].includes(response.status));
    const text = await response.text();
    assert.ok(!text.includes("TESTOVACÍ ROČNÍK"));
    assert.ok(!text.includes(alice.email));
  }
});

test("participant cannot promote self, access admin/export, or edit/delete another activity", async (t) => {
  const f = await fixture(t);
  const a = await f.activity(alice);
  const state = await f.getState(bob);
  const attempts = [
    { action: "updateMember", id: state.me.id, role: "admin" },
    { action: "saveCourse", name: "hijack" },
    {
      action: "saveActivity",
      id: a.id,
      idempotencyKey: "attack",
      typeId: a.typeId,
      date: a.date,
      minutes: 999,
      note: "hijack",
    },
    { action: "deleteActivity", id: a.id },
  ];
  for (const body of attempts) {
    const response = await f.request(bob, "/api/action", body);
    assert.ok(response.status >= 400, JSON.stringify(body));
  }
  for (const path of ["/api/admin", "/api/export.csv"])
    assert.equal((await f.request(bob, path)).status, 403);
  assert.equal(
    (await f.getState(alice)).activities.find((x) => x.id === a.id)?.minutes,
    35,
  );
});

test("revocation takes effect immediately for an already established identity", async (t) => {
  const f = await fixture(t);
  const state = await f.getState(alice);
  await f.call(admin, "updateMember", { id: state.me.id, active: false });
  assert.equal((await f.request(alice)).status, 403);
  const response = await f.request(alice, "/api/action", {
    action: "saveProfile",
    nickname: "Still here",
    animations: true,
  });
  assert.equal(response.status, 403);
});

test("participant responses omit other members’ emails and private push credentials", async (t) => {
  const f = await fixture(t);
  const response = await f.request(alice);
  const body = await response.text();
  for (const email of [admin.email, bob.email])
    assert.ok(!body.includes(email), email);
  for (const m of JSON.parse(body).members) assert.equal(m.email, undefined);
  assert.ok(!body.includes("vapidPrivateKey"));
  assert.ok(!body.includes("endpoint"));
  assert.match(response.headers.get("cache-control") ?? "", /no-store/);
});

test("activity persists across requests/accounts; idempotency retries do not duplicate; same day allows separate activities", async (t) => {
  const f = await fixture(t);
  const state = await f.getState(alice);
  const key = crypto.randomUUID();
  const payload = {
    action: "saveActivity",
    idempotencyKey: key,
    typeId: f.foot.id,
    date: "2026-10-20",
    minutes: 30,
    distance: 2,
    note: "One real walk",
  };
  await f.ok(alice, "/api/action", payload);
  await f.ok(alice, "/api/action", payload);
  const shared = await f.getState(bob);
  assert.equal(
    shared.activities.filter((x) => x.note === payload.note).length,
    1,
  );
  await f.activity(alice, { date: "2026-10-20", minutes: null });
  assert.equal(f.db.count("activities", "member_id=?", state.me.id), 2);
  const summary = (await f.getState(alice)).summary;
  assert.equal(summary.activities, 2);
  assert.equal(summary.movementDays, 1);
  assert.equal(summary.minutes, 30);
  assert.equal(summary.missingMinutes, 1);
});

test("backdated Sunday stays in Sunday week; edit/date move/delete reconcile awards", async (t) => {
  const f = await fixture(t);
  f.setNow("2026-10-26T12:00:00Z");
  const a = await f.activity(alice, { date: "2026-10-23", minutes: 30 });
  const b = await f.activity(alice, { date: "2026-10-24", minutes: 30 });
  const c = await f.activity(alice, { date: "2026-10-25", minutes: 30 });
  let s = await f.getState(alice);
  const who = s.me.id;
  const rhythm = s.rules.find(
    (r) => r.rule.condition.kind === "days" && r.rule.period === "week",
  )!.rule.key;
  assert.ok(
    s.awards.some(
      (x) =>
        x.memberId === who &&
        x.ruleKey === rhythm &&
        x.periodStart === "2026-10-19",
    ),
  );
  assert.equal(
    s.summary.weeks.find((x) => x.week === "2026-10-19")?.movementDays,
    3,
  );
  await f.call(alice, "saveActivity", {
    ...c,
    idempotencyKey: crypto.randomUUID(),
    date: "2026-10-26",
  });
  s = await f.getState(alice);
  assert.ok(
    !s.awards.some(
      (x) =>
        x.memberId === who &&
        x.ruleKey === rhythm &&
        x.periodStart === "2026-10-19",
    ),
  );
  assert.equal(
    s.summary.weeks.find((x) => x.week === "2026-10-19")?.movementDays,
    2,
  );
  assert.equal(
    s.summary.weeks.find((x) => x.week === "2026-10-26")?.movementDays,
    1,
  );
  await f.call(alice, "deleteActivity", { id: b.id });
  await f.call(alice, "deleteActivity", { id: a.id });
  s = await f.getState(alice);
  assert.equal(s.activities.filter((x) => x.memberId === who).length, 1);
});

test("future and out-of-preparation activities, invalid quantities and malformed dates are rejected", async (t) => {
  const f = await fixture(t);
  for (const values of [
    { date: "2026-10-26" },
    { date: "2026-09-27" },
    { date: "2026-02-30" },
    { minutes: -1 },
    { distance: -1 },
    { minutes: "NaN" },
  ]) {
    const response = await f.request(alice, "/api/action", {
      action: "saveActivity",
      idempotencyKey: crypto.randomUUID(),
      typeId: f.foot.id,
      date: "2026-10-20",
      minutes: 30,
      note: "invalid",
      ...values,
    });
    assert.ok(response.status >= 400, JSON.stringify(values));
  }
  assert.equal(f.db.count("activities"), 0);
});

test("hidden task metadata never enters participant state; publishing reveals only selected task", async (t) => {
  const f = await fixture(t);
  const administrative = await f.ok(admin, "/api/admin");
  const hidden = administrative.challenges.filter((c: any) => c.hidden);
  assert.ok(hidden.length >= 2);
  let text = JSON.stringify(await f.getState(alice));
  for (const challenge of hidden) {
    assert.ok(!text.includes(challenge.id));
    assert.ok(!text.includes(challenge.name));
  }
  const hiddenType = administrative.types.find((type: any) => type.hidden);
  assert.ok(hiddenType);
  assert.ok(!text.includes(hiddenType.id));
  assert.ok(!text.includes(hiddenType.name));
  const bad = await f.request(alice, "/api/action", {
    action: "completeChallenge",
    id: hidden[0].id,
    date: "2026-10-25",
    note: "guess",
    completed: true,
  });
  assert.ok(bad.status >= 400);
  await f.call(admin, "publishChallenge", { id: hidden[0].id, announce: true });
  text = JSON.stringify(await f.getState(alice));
  assert.ok(text.includes(hidden[0].name));
  assert.ok(!text.includes(hidden[1].id));
  assert.ok(!text.includes(hidden[1].name));
});

test("draft challenges remain secret regardless of hidden flag; future completion is rejected", async (t) => {
  const f = await fixture(t);
  await f.call(admin, "saveChallenge", {
    name: "Unannounced unique test challenge",
    description: "Never public yet",
    startDate: "2026-10-27",
    endDate: "2026-10-28",
    condition: { kind: "manual", count: 1 },
    reward: "Bonus",
    status: "draft",
    hidden: false,
  });
  const administrative = await f.ok(admin, "/api/admin");
  const draft = administrative.challenges.find(
    (c: any) => c.name === "Unannounced unique test challenge",
  );
  assert.ok(draft);
  assert.ok(!JSON.stringify(await f.getState(alice)).includes(draft.name));
  await f.call(admin, "publishChallenge", { id: draft.id, announce: false });
  assert.ok(
    (await f.getState(alice)).challenges.some((c) => c.id === draft.id),
  );
  const response = await f.request(alice, "/api/action", {
    action: "completeChallenge",
    id: draft.id,
    date: "2026-10-27",
    note: "future",
    completed: true,
  });
  assert.ok(response.status >= 400);
});

test("comments/reactions persist, only own comment editable, organizer can moderate", async (t) => {
  const f = await fixture(t);
  const activity = await f.activity(alice);
  await f.call(bob, "saveComment", {
    activityId: activity.id,
    body: "Pekná prechádzka!",
  });
  let state = await f.getState(alice);
  const comment = state.activities.find((a) => a.id === activity.id)!
    .comments![0];
  assert.equal(comment.body, "Pekná prechádzka!");
  const forbidden = await f.request(alice, "/api/action", {
    action: "saveComment",
    id: comment.id,
    activityId: activity.id,
    body: "I own it",
  });
  assert.equal(forbidden.status, 403);
  await f.call(bob, "saveComment", {
    id: comment.id,
    activityId: activity.id,
    body: "Upravený komentár",
  });
  await f.call(bob, "reaction", { activityId: activity.id });
  state = await f.getState(alice);
  assert.equal(
    state.activities.find((a) => a.id === activity.id)!.reactions!.length,
    1,
  );
  await f.call(bob, "reaction", { activityId: activity.id });
  state = await f.getState(alice);
  assert.equal(
    state.activities.find((a) => a.id === activity.id)!.reactions!.length,
    0,
  );
  await f.call(admin, "deleteComment", { id: comment.id });
  assert.equal(
    (await f.getState(bob)).activities.find((a) => a.id === activity.id)!
      .comments!.length,
    0,
  );
});

test("targeted messages stay private; send retries and per-user read state are idempotent", async (t) => {
  const f = await fixture(t);
  const a = await f.getState(alice),
    b = await f.getState(bob);
  await f.call(admin, "saveMessage", {
    title: "Only Alica",
    body: "Private message body",
    link: "/?view=challenges",
    important: true,
    pinned: true,
    audience: "selected",
    recipients: [a.me.id],
    push: false,
  });
  let administrative = await f.ok(admin, "/api/admin");
  const message = administrative.messages.find(
    (m: any) => m.title === "Only Alica",
  );
  assert.ok(message);
  assert.ok(
    !(await f.getState(alice)).messages.some((m) => m.id === message.id),
  );
  await f.call(admin, "sendMessage", { id: message.id });
  await f.call(admin, "sendMessage", { id: message.id });
  let delivered = (await f.getState(alice)).messages.find(
    (m) => m.id === message.id,
  )!;
  assert.ok(delivered);
  assert.equal(delivered.readAt, null);
  assert.ok(!(await f.getState(bob)).messages.some((m) => m.id === message.id));
  assert.equal(f.db.count("recipients", "message_id=?", message.id), 1);
  await f.request(bob, "/api/action", {
    action: "readMessage",
    id: message.id,
  });
  assert.equal(
    (await f.getState(alice)).messages.find((m) => m.id === message.id)!.readAt,
    null,
  );
  await f.call(alice, "readMessage", { id: message.id });
  delivered = (await f.getState(alice)).messages.find(
    (m) => m.id === message.id,
  )!;
  assert.ok(delivered.readAt);
  const late = {
    userId: "late-id",
    email: "late@example.test",
    displayName: "Later",
  };
  await f.call(admin, "inviteMember", {
    email: late.email,
    nickname: late.displayName,
    role: "participant",
  });
  assert.ok(
    !(await f.getState(late)).messages.some((m) => m.id === message.id),
  );
  assert.ok(b.me.id !== a.me.id);
});

test("new rules apply prospectively; old award snapshots survive changes and old edits use original version", async (t) => {
  const f = await fixture(t);
  for (const date of ["2026-10-19", "2026-10-20", "2026-10-21"])
    await f.activity(alice, { date });
  let state = await f.getState(alice);
  const rule = state.rules.find(
    (r) => r.rule.condition.kind === "days" && r.rule.period === "week",
  )!.rule;
  const earned = state.awards.find(
    (a) => a.memberId === state.me.id && a.ruleKey === rule.key,
  )!;
  assert.ok(earned);
  await f.call(admin, "saveRule", {
    ...rule,
    condition: { kind: "days", count: 6 },
  });
  state = await f.getState(alice);
  const retained = state.awards.find((a) => a.id === earned.id)!;
  assert.ok(retained);
  assert.equal(retained.ruleVersion, earned.ruleVersion);
  assert.deepEqual(retained.snapshot, earned.snapshot);
  const old = state.activities.find((a) => a.memberId === state.me.id)!;
  await f.call(alice, "saveActivity", {
    ...old,
    idempotencyKey: crypto.randomUUID(),
    minutes: 45,
  });
  state = await f.getState(alice);
  assert.ok(
    state.awards.some(
      (a) => a.ruleKey === rule.key && a.ruleVersion === rule.version,
    ),
  );
});

test("CSRF origin checks reject foreign-site writes; participant cannot use manual admin action", async (t) => {
  const f = await fixture(t);
  const response = await f.request(
    alice,
    "/api/action",
    { action: "saveProfile", nickname: "cross-site", animations: true },
    "https://attacker.example",
  );
  assert.equal(response.status, 403);
  const denied = await f.request(alice, "/api/action", {
    action: "publishChallenge",
    id: "guessed",
    announce: true,
  });
  assert.equal(denied.status, 403);
});

test("public text remains inert plain text and CSV export escapes spreadsheet formulas", async (t) => {
  const f = await fixture(t);
  const note = '=HYPERLINK("https://attacker.example","x")';
  await f.activity(alice, { note });
  await f.call(alice, "saveProfile", {
    nickname: "<script>alert(1)</script>",
    animations: true,
  });
  assert.equal(
    (await f.getState(alice)).me.nickname,
    "<script>alert(1)</script>",
  );
  const response = await f.request(admin, "/api/export.csv");
  assert.equal(response.status, 200);
  const csv = await response.text();
  assert.ok(!csv.includes('"=HYPERLINK'));
  assert.ok(csv.includes("HYPERLINK"));
});

test("course isolation ignores injected course/member IDs and excludes other course records", async (t) => {
  const f = await fixture(t);
  const state = await f.getState(alice);
  const second = {
    ...state.course,
    id: "other-course",
    name: "PRIVATE OTHER COURSE",
  };
  f.db.sqlite
    .prepare("INSERT INTO courses(id,data) VALUES(?,?)")
    .run(second.id, JSON.stringify(second));
  f.db.sqlite
    .prepare(
      "INSERT INTO members(id,course_id,user_id,email,nickname,role,active,animations,joined_at) VALUES(?,?,?,?,?,?,1,1,?)",
    )
    .run(
      "other-member",
      second.id,
      "other-user",
      "other@example.test",
      "Private outsider",
      "participant",
      "2026-10-01T12:00:00Z",
    );
  f.db.sqlite
    .prepare(
      "INSERT INTO activity_types(id,course_id,name,group_name,hidden,active) VALUES(?,?,?,?,0,1)",
    )
    .run("other-type", second.id, "Other secret walk", "foot");
  f.db.sqlite
    .prepare(
      "INSERT INTO activities(id,course_id,member_id,type_id,date,minutes,distance,note,created_at,updated_at,idempotency_key) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
    )
    .run(
      "other-activity",
      second.id,
      "other-member",
      "other-type",
      "2026-10-20",
      30,
      null,
      "PRIVATE OTHER ACTIVITY",
      "2026-10-20T12:00:00Z",
      "2026-10-20T12:00:00Z",
      "other-key",
    );
  assert.ok(!JSON.stringify(await f.getState(alice)).includes("PRIVATE OTHER"));
  const deletion = await f.request(admin, "/api/action", {
    action: "deleteActivity",
    id: "other-activity",
    courseId: second.id,
  });
  assert.ok(deletion.status >= 400);
  const creation = await f.request(alice, "/api/action", {
    action: "saveActivity",
    idempotencyKey: "cross-course",
    courseId: second.id,
    memberId: "other-member",
    typeId: "other-type",
    date: "2026-10-20",
    minutes: 30,
    note: "cross-course",
  });
  assert.ok(creation.status >= 400);
  assert.equal(f.db.count("activities", "id=?", "other-activity"), 1);
});

test("manual bonus task is persistent and does not create movement days or training minutes", async (t) => {
  const f = await fixture(t);
  await f.call(admin, "saveChallenge", {
    name: "Practical test task",
    description: "Optional practical effort",
    startDate: "2026-10-19",
    endDate: "2026-10-25",
    condition: { kind: "manual", count: 1 },
    reward: "Optional bonus",
    status: "draft",
    hidden: false,
  });
  const administrative = await f.ok(admin, "/api/admin");
  const task = administrative.challenges.find(
    (c: any) => c.name === "Practical test task",
  );
  assert.ok(task);
  await f.call(admin, "publishChallenge", { id: task.id, announce: false });
  await f.call(alice, "completeChallenge", {
    id: task.id,
    date: "2026-10-25",
    note: "Done without timing",
    completed: true,
  });
  await f.call(alice, "completeChallenge", {
    id: task.id,
    date: "2026-10-25",
    note: "Done without timing",
    completed: true,
  });
  const state = await f.getState(alice);
  assert.equal(state.challenges.find((c) => c.id === task.id)?.completed, true);
  assert.equal(state.summary.movementDays, 0);
  assert.equal(state.summary.minutes, null);
  assert.equal(f.db.count("completions", "challenge_id=?", task.id), 1);
  await f.call(alice, "completeChallenge", { id: task.id, completed: false });
  assert.equal(
    (await f.getState(alice)).challenges.find((c) => c.id === task.id)
      ?.completed,
    false,
  );
});

test("repeated calculation has stable award identities and deleting qualifying data removes its award", async (t) => {
  const f = await fixture(t);
  for (const date of ["2026-10-19", "2026-10-20", "2026-10-21"])
    await f.activity(alice, { date });
  const before = await f.getState(alice);
  const ids = before.awards.map((a) => a.id).sort();
  assert.ok(ids.length > 0);
  for (let repeat = 0; repeat < 3; repeat++)
    assert.deepEqual(
      (await f.getState(alice)).awards.map((a) => a.id).sort(),
      ids,
    );
  assert.equal(f.db.count("awards"), ids.length);
  for (const activity of before.activities)
    await f.call(alice, "deleteActivity", { id: activity.id });
  assert.equal((await f.getState(alice)).awards.length, 0);
  assert.equal(f.db.count("awards"), 0);
});

test("concurrent duplicate saves and sends remain one persistent record per identity key", async (t) => {
  const f = await fixture(t);
  const state = await f.getState(alice);
  const payload = {
    action: "saveActivity",
    idempotencyKey: "one-double-click",
    typeId: f.foot.id,
    date: "2026-10-20",
    minutes: 30,
    note: "Concurrent walk",
  };
  const results = await Promise.all([
    f.request(alice, "/api/action", payload),
    f.request(alice, "/api/action", payload),
  ]);
  for (const response of results)
    assert.equal(response.status, 200, await response.text());
  assert.equal(f.db.count("activities", "member_id=?", state.me.id), 1);
  const saved = await f.call(admin, "saveMessage", {
    title: "Double send",
    body: "One message",
    link: "",
    important: false,
    pinned: false,
    audience: "selected",
    recipients: [state.me.id],
    push: false,
  });
  const responses = await Promise.all([
    f.request(admin, "/api/action", { action: "sendMessage", id: saved.id }),
    f.request(admin, "/api/action", { action: "sendMessage", id: saved.id }),
  ]);
  for (const response of responses)
    assert.equal(response.status, 200, await response.text());
  assert.equal(f.db.count("recipients", "message_id=?", saved.id), 1);
});

test("retrospective rules require a fresh consequence preview and consume the approved token", async (t) => {
  const f = await fixture(t);
  for (const date of ["2026-10-19", "2026-10-20", "2026-10-21"])
    await f.activity(alice, { date });
  const state = await f.getState(alice);
  const rule = state.rules.find(
    (r) => r.rule.condition.kind === "days" && r.rule.period === "week",
  )!.rule;
  await f.call(admin, "saveRule", {
    ...rule,
    condition: { kind: "days", count: 6 },
  });
  const preview = await f.call(admin, "previewRecalculation", {
    ruleKey: rule.key,
  });
  const effect = preview.changes.find(
    (change: any) => change.memberId === state.me.id,
  );
  assert.equal(effect.before, 1);
  assert.equal(effect.after, 0);
  await f.activity(alice, { date: "2026-10-22" });
  const stale = await f.request(admin, "/api/action", {
    action: "applyRecalculation",
    ruleKey: rule.key,
    previewToken: preview.previewToken,
  });
  assert.equal(stale.status, 409);
  const fresh = await f.call(admin, "previewRecalculation", {
    ruleKey: rule.key,
  });
  await f.call(admin, "applyRecalculation", {
    ruleKey: rule.key,
    previewToken: fresh.previewToken,
  });
  assert.ok(
    !(await f.getState(alice)).awards.some(
      (a) => a.memberId === state.me.id && a.ruleKey === rule.key,
    ),
  );
  assert.equal(
    (
      await f.request(admin, "/api/action", {
        action: "applyRecalculation",
        ruleKey: rule.key,
        previewToken: fresh.previewToken,
      })
    ).status,
    409,
  );
});

test("malformed calendar dates and JSON shapes return validation errors, not server failures", async (t) => {
  const f = await fixture(t);
  for (const date of [
    "2026-13-01",
    "2026-00-10",
    "2026-02-30",
    "2026-12-00",
    "not-a-date",
  ]) {
    const response = await f.request(alice, "/api/action", {
      action: "saveActivity",
      idempotencyKey: crypto.randomUUID(),
      typeId: f.foot.id,
      date,
      minutes: 30,
      note: "Invalid date",
    });
    assert.equal(response.status, 400, date);
  }
  for (const body of [null, [], 1, "text", true])
    assert.equal(
      (await f.request(alice, "/api/action", body)).status,
      400,
      JSON.stringify(body),
    );
  assert.equal(f.db.count("activities"), 0);
});

test("invalid push subscriptions are rejected as bad input and never persisted", async (t) => {
  const f = await fixture(t);
  Object.assign(f.config, {
    vapidPublicKey: "test-public-config",
    vapidPrivateKey: "test-private-config",
    vapidSubject: "mailto:admin@example.test",
  });
  for (const subscription of [
    null,
    {},
    { endpoint: "http://localhost/internal", keys: {} },
    {
      endpoint: "https://fcm.googleapis.com/a",
      keys: { p256dh: "not-valid", auth: "no" },
    },
  ]) {
    const response = await f.request(alice, "/api/action", {
      action: "pushSubscribe",
      subscription,
    });
    assert.equal(response.status, 400);
  }
  assert.equal(f.db.count("subscriptions"), 0);
  const state = JSON.stringify(await f.getState(alice));
  assert.ok(!state.includes("test-private-config"));
});

test("organizer moderation deletes foreign activity with audit and recalculates the author only", async (t) => {
  const f = await fixture(t);
  const first = await f.activity(alice, { date: "2026-10-19" });
  await f.activity(alice, { date: "2026-10-20" });
  let state = await f.getState(alice);
  const key = state.rules.find((p) => p.rule.key === "foot")!.rule.key;
  assert.ok(
    state.awards.some((a) => a.memberId === state.me.id && a.ruleKey === key),
  );
  await f.call(admin, "deleteActivity", { id: first.id });
  state = await f.getState(alice);
  assert.ok(!state.activities.some((a) => a.id === first.id));
  assert.ok(
    !state.awards.some((a) => a.memberId === state.me.id && a.ruleKey === key),
  );
  assert.equal(f.db.count("audit", "action='moderateActivity'"), 1);
  const remaining = state.activities[0];
  assert.equal(
    (
      await f.request(admin, "/api/action", {
        action: "saveActivity",
        ...remaining,
        idempotencyKey: "foreign-edit",
        minutes: 1,
      })
    ).status,
    403,
  );
});

test("inactive historical activity type can be corrected but cannot be used for new records", async (t) => {
  const f = await fixture(t);
  const a = await f.activity(alice, { distance: 0 });
  assert.equal(a.distance, 0);
  await f.call(admin, "saveType", { ...f.foot, active: false });
  await f.call(alice, "saveActivity", {
    ...a,
    idempotencyKey: "edit-inactive",
    minutes: 45,
  });
  assert.equal(
    (await f.getState(alice)).activities.find((x) => x.id === a.id)?.minutes,
    45,
  );
  assert.equal(
    (
      await f.request(alice, "/api/action", {
        action: "saveActivity",
        idempotencyKey: "new-inactive",
        typeId: f.foot.id,
        date: "2026-10-20",
        minutes: 45,
        note: "No",
      })
    ).status,
    400,
  );
});

test("rule preview lists added and removed periods even when total award count stays unchanged", async (t) => {
  const f = await fixture(t);
  for (const date of ["2026-10-12", "2026-10-13"])
    await f.activity(alice, { date });
  for (const date of ["2026-10-19", "2026-10-20"])
    await f.activity(alice, { date, typeId: f.exercise.id, minutes: 20 });
  const state = await f.getState(alice);
  const rule = state.rules.find((r) => r.rule.key === "foot")!.rule;
  await f.call(admin, "saveRule", {
    ...rule,
    condition: {
      kind: "activities",
      count: 2,
      groups: ["exercise"],
      minMinutes: 15,
    },
  });
  const preview = await f.call(admin, "previewRecalculation", {
    ruleKey: rule.key,
  });
  const effect = preview.changes.find(
    (item: any) => item.memberId === state.me.id,
  );
  assert.equal(effect.before, 1);
  assert.equal(effect.after, 1);
  assert.deepEqual(effect.removedPeriods, [
    { startDate: "2026-10-12", endDate: "2026-10-18" },
  ]);
  assert.deepEqual(effect.addedPeriods, [
    { startDate: "2026-10-19", endDate: "2026-10-25" },
  ]);
  await f.call(admin, "applyRecalculation", {
    ruleKey: rule.key,
    previewToken: preview.previewToken,
  });
  const awards = (await f.getState(alice)).awards.filter(
    (a) => a.memberId === state.me.id && a.ruleKey === rule.key,
  );
  assert.deepEqual(
    awards.map((a) => a.periodStart),
    ["2026-10-19"],
  );
});

test("course changes invalidate retrospective preview and manual tasks are scoped to their recorded week", async (t) => {
  const f = await fixture(t);
  await f.call(alice, "completeGear", {
    date: "2026-10-20",
    completed: true,
    note: "Checked layers and borrowing plan",
  });
  const state = await f.getState(alice);
  const rule = state.rules.find((r) => r.rule.key === "foot")!.rule;
  // Legacy/imported version: current administration intentionally forbids manual
  // conditions on movement rewards, but historical data must remain period-safe.
  const legacy = {
    ...rule,
    id: "legacy-manual-foot-v2",
    version: 2,
    effectiveFrom: state.course.startDate,
    condition: { kind: "manual", count: 1 },
  };
  f.db.sqlite
    .prepare(
      "INSERT INTO rules(id,course_id,key,version,effective_from,data) VALUES(?,?,?,?,?,?)",
    )
    .run(
      legacy.id,
      state.course.id,
      legacy.key,
      legacy.version,
      legacy.effectiveFrom,
      JSON.stringify(legacy),
    );
  const old = await f.call(admin, "previewRecalculation", {
    ruleKey: rule.key,
  });
  await f.call(admin, "saveCourse", {
    ...state.course,
    name: "Renamed test course",
  });
  assert.equal(
    (
      await f.request(admin, "/api/action", {
        action: "applyRecalculation",
        ruleKey: rule.key,
        previewToken: old.previewToken,
      })
    ).status,
    409,
  );
  const preview = await f.call(admin, "previewRecalculation", {
    ruleKey: rule.key,
  });
  const effect = preview.changes.find((c: any) => c.memberId === state.me.id);
  assert.equal(effect.after, 1);
  await f.call(admin, "applyRecalculation", {
    ruleKey: rule.key,
    previewToken: preview.previewToken,
  });
  f.setNow("2026-11-02T12:00:00Z");
  const awards = (await f.getState(alice)).awards.filter(
    (a) => a.memberId === state.me.id && a.ruleKey === rule.key,
  );
  assert.deepEqual(
    awards.map((a) => a.periodStart),
    ["2026-10-19"],
  );
});

test("combination challenge preserves manual confirmation separately from total completion", async (t) => {
  const f = await fixture(t);
  const saved = await f.call(admin, "saveChallenge", {
    name: "Practical plus movement",
    description: "Both parts",
    startDate: "2026-10-19",
    endDate: "2026-10-25",
    condition: {
      kind: "combination",
      conditions: [
        { kind: "manual", count: 1 },
        { kind: "activities", groups: ["foot"], count: 1, minMinutes: 30 },
      ],
    },
    reward: "Bonus",
    hidden: false,
  });
  await f.call(admin, "publishChallenge", { id: saved.id, announce: false });
  await f.call(alice, "completeChallenge", {
    id: saved.id,
    date: "2026-10-20",
    completed: true,
    note: "Checked",
  });
  let c: any = (await f.getState(alice)).challenges.find(
    (c) => c.id === saved.id,
  );
  assert.equal(c.manualCompleted, true);
  assert.equal(c.completed, false);
  assert.deepEqual(c.completion, { date: "2026-10-20", note: "Checked" });
  await f.activity(alice);
  c = (await f.getState(alice)).challenges.find((c) => c.id === saved.id);
  assert.equal(c.completed, true);
  f.setNow("2026-11-02T12:00:00Z");
  await f.call(alice, "completeChallenge", { id: saved.id, completed: false });
  c = (await f.getState(alice)).challenges.find((c) => c.id === saved.id);
  assert.equal(c.completed, false);
});

test("SMTP-enabled invitation queues without a second email provider", async (t) => {
  const f = await fixture(t);
  f.config.emailEnabled = true;
  const invited = await f.call(admin, "inviteMember", {
    email: "smtp@example.test",
    nickname: "SMTP participant",
    role: "participant",
  });
  assert.match(invited.warning, /fronte/);
  assert.equal(
    f.db.count("outbox", "kind='email' AND member_id=?", invited.id),
    1,
  );
});

test("basic reward edits preserve practical-vs-movement paths and reject excessive rule depth", async (t) => {
  const f = await fixture(t);
  const state = await f.getState(alice);
  const foot = state.rules.find((p) => p.rule.key === "foot")!.rule,
    gear = state.rules.find((p) => p.rule.key === "equipment")!.rule;
  for (const condition of [
    { kind: "manual", count: 1 },
    {
      kind: "combination",
      conditions: [
        { kind: "manual", count: 1 },
        { kind: "days", count: 2 },
      ],
    },
  ])
    assert.equal(
      (
        await f.request(admin, "/api/action", {
          action: "saveRule",
          ...foot,
          condition,
        })
      ).status,
      400,
    );
  assert.equal(
    (
      await f.request(admin, "/api/action", {
        action: "saveRule",
        ...gear,
        condition: { kind: "activities", count: 1 },
      })
    ).status,
    400,
  );
  let nested: any = { kind: "days", count: 1 };
  for (let depth = 0; depth < 8; depth++)
    nested = { kind: "combination", conditions: [nested] };
  assert.equal(
    (
      await f.request(admin, "/api/action", {
        action: "saveRule",
        ...foot,
        condition: nested,
      })
    ).status,
    400,
  );
  await f.call(admin, "saveRule", {
    ...gear,
    description: "Skontroluj a spíš plán požičania výbavy.",
    condition: { kind: "manual", count: 1 },
  });
});

test("retrospective rule, awards, audit, and preview consumption commit atomically", async (t) => {
  const f = await fixture(t);
  await f.activity(alice);
  const state = await f.getState(alice),
    rule = state.rules.find((p) => p.rule.key === "foot")!.rule;
  await f.call(admin, "saveRule", {
    ...rule,
    condition: {
      kind: "activities",
      count: 1,
      groups: ["foot"],
      minMinutes: 30,
    },
  });
  const preview = await f.call(admin, "previewRecalculation", {
    ruleKey: rule.key,
  });
  const beforeRules = f.db.count("rules"),
    beforeAudit = f.db.count("audit");
  f.db.sqlite.exec(
    "CREATE TRIGGER test_reject_award BEFORE INSERT ON awards WHEN NEW.rule_key='foot' BEGIN SELECT RAISE(ABORT,'Test-only persistence failure'); END;",
  );
  const failed = await f.request(admin, "/api/action", {
    action: "applyRecalculation",
    ruleKey: rule.key,
    previewToken: preview.previewToken,
  });
  assert.equal(failed.status, 500);
  assert.equal(f.db.count("rules"), beforeRules);
  assert.equal(f.db.count("audit"), beforeAudit);
  assert.equal(
    f.db.count("recalculation_previews", "id=?", preview.previewToken),
    1,
  );
  assert.equal(f.db.count("awards", "rule_key='foot'"), 0);
  f.db.sqlite.exec("DROP TRIGGER test_reject_award");
  await f.call(admin, "applyRecalculation", {
    ruleKey: rule.key,
    previewToken: preview.previewToken,
  });
  assert.equal(f.db.count("awards", "rule_key='foot'"), 1);
});

test("initial course dates align unused base rules and whole-course hidden draft tasks", async (t) => {
  const f = await fixture(t);
  const state = await f.getState(admin);
  await f.call(admin, "saveCourse", {
    ...state.course,
    startDate: "2026-09-14",
    endDate: "2027-01-31",
  });
  const configured = await f.getState(alice);
  assert.ok(configured.rules.some((p) => p.periodStart === "2026-09-14"));
  const administrative = await f.ok(admin, "/api/admin");
  for (const ch of administrative.challenges.filter((c: any) => c.hidden)) {
    assert.equal(ch.startDate, "2026-09-14");
    assert.equal(ch.endDate, "2027-01-31");
  }
  await f.activity(alice, { date: "2026-09-14" });
  await f.activity(alice, { date: "2026-09-15" });
  assert.ok(
    (await f.getState(alice)).awards.some(
      (a) => a.ruleKey === "foot" && a.periodStart === "2026-09-14",
    ),
  );
});

test("course bounds cannot silently exclude manual confirmations or published challenges", async (t) => {
  const f = await fixture(t);
  const state = await f.getState(admin);
  await f.call(alice, "completeGear", {
    date: "2026-10-25",
    completed: true,
    note: "Checked",
  });
  assert.equal(
    (
      await f.request(admin, "/api/action", {
        action: "saveCourse",
        ...state.course,
        endDate: "2026-10-24",
      })
    ).status,
    409,
  );
  const saved = await f.call(admin, "saveChallenge", {
    name: "Published future task",
    description: "Keep its published dates",
    startDate: "2026-12-29",
    endDate: "2026-12-31",
    condition: { kind: "manual", count: 1 },
    reward: "Bonus",
    hidden: false,
  });
  await f.call(admin, "publishChallenge", { id: saved.id, announce: false });
  assert.equal(
    (
      await f.request(admin, "/api/action", {
        action: "saveCourse",
        ...state.course,
        endDate: "2026-12-30",
      })
    ).status,
    409,
  );
});

test("concurrent admin demotions cannot remove the final active organizer", async (t) => {
  const f = await fixture(t);
  const aliceState = await f.getState(alice),
    adminState = await f.getState(admin);
  await f.call(admin, "updateMember", { id: aliceState.me.id, role: "admin" });
  const outcomes = await Promise.all([
    f.request(admin, "/api/action", {
      action: "updateMember",
      id: adminState.me.id,
      role: "participant",
    }),
    f.request(alice, "/api/action", {
      action: "updateMember",
      id: aliceState.me.id,
      role: "participant",
    }),
  ]);
  assert.deepEqual(outcomes.map((r) => r.status).sort(), [200, 409]);
  assert.equal(f.db.count("members", "role='admin' AND active=1"), 1);
});

test("manual close is inclusive today, permits past corrections, and forbids reopening", async (t) => {
  const f = await fixture(t);
  const saved = await f.call(admin, "saveChallenge", {
    name: "Close early",
    description: "Scheduled for another week",
    startDate: "2026-10-19",
    endDate: "2026-11-01",
    condition: { kind: "manual", count: 1 },
    reward: "Bonus",
    hidden: false,
  });
  await f.call(admin, "publishChallenge", { id: saved.id, announce: false });
  await f.call(admin, "endChallenge", { id: saved.id });
  let c = (await f.getState(alice)).challenges.find((c) => c.id === saved.id)!;
  assert.equal(c.status, "ended");
  assert.equal(c.endDate, "2026-10-25");
  f.setNow("2026-10-27T12:00:00Z");
  await f.call(alice, "completeChallenge", {
    id: saved.id,
    date: "2026-10-25",
    completed: true,
    note: "Completed on inclusive last day",
  });
  assert.equal(
    (
      await f.request(alice, "/api/action", {
        action: "completeChallenge",
        id: saved.id,
        date: "2026-10-26",
        completed: true,
        note: "Too late",
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await f.request(admin, "/api/action", {
        action: "publishChallenge",
        id: saved.id,
        announce: false,
      })
    ).status,
    409,
  );
  await f.call(alice, "completeChallenge", { id: saved.id, completed: false });
  c = (await f.getState(alice)).challenges.find((c) => c.id === saved.id)!;
  assert.equal(c.completed, false);
});

test("future challenge closed before its start has an empty fulfillment window forever", async (t) => {
  const f = await fixture(t);
  const saved = await f.call(admin, "saveChallenge", {
    name: "Cancel before start",
    description: "Will not open",
    startDate: "2026-10-27",
    endDate: "2026-11-01",
    condition: {
      kind: "activities",
      count: 1,
      groups: ["foot"],
      minMinutes: 30,
    },
    reward: "Bonus",
    hidden: false,
  });
  await f.call(admin, "publishChallenge", { id: saved.id, announce: false });
  await f.call(admin, "endChallenge", { id: saved.id });
  f.setNow("2026-10-29T12:00:00Z");
  await f.activity(alice, { date: "2026-10-27" });
  const c = (await f.getState(alice)).challenges.find(
    (c) => c.id === saved.id,
  )!;
  assert.equal(c.status, "ended");
  assert.ok(c.endDate < c.startDate);
  assert.equal(c.completed, false);
  assert.equal(c.progress!.current, 0);
  assert.equal(
    (
      await f.request(admin, "/api/action", {
        action: "publishChallenge",
        id: saved.id,
        announce: true,
      })
    ).status,
    409,
  );
});

async function validDeviceSubscription(
  endpoint = "https://fcm.googleapis.com/fcm/send/scope-test",
) {
  const key = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"],
  );
  return {
    endpoint,
    expirationTime: null,
    keys: {
      p256dh: Buffer.from(
        await crypto.subtle.exportKey("raw", key.publicKey),
      ).toString("base64url"),
      auth: Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString(
        "base64url",
      ),
    },
  };
}

test("push enrollment stores only server-trusted deployment URL and normalizes trailing slash", async (t) => {
  const f = await fixture(t);
  Object.assign(f.config, {
    siteUrl: "https://hub.biketrek.sk/zk/",
    vapidPublicKey: "test-public",
    vapidPrivateKey: "test-private",
    vapidSubject: "mailto:admin@example.test",
  });
  const subscription = await validDeviceSubscription();
  await f.call(alice, "pushSubscribe", {
    subscription: {
      ...subscription,
      applicationUrl: "https://attacker.example/forged",
    },
  });
  const row = f.db.sqlite
    .prepare("SELECT data FROM subscriptions WHERE endpoint=?")
    .get(subscription.endpoint) as { data: string };
  assert.equal(
    JSON.parse(row.data).applicationUrl,
    "https://hub.biketrek.sk/zk",
  );
  f.config.siteUrl = "https://hub.biketrek.sk/zk";
  assert.equal(
    (await f.call(alice, "pushStatus", { endpoint: subscription.endpoint }))
      .subscribed,
    true,
  );
  assert.ok(
    !JSON.stringify(await f.getState(alice)).includes(subscription.endpoint),
  );
});

test("push registration becomes stale on domain/path migration and requires explicit new enrollment", async (t) => {
  const f = await fixture(t);
  Object.assign(f.config, {
    siteUrl: "https://hub.biketrek.sk/zk",
    vapidPublicKey: "test-public",
    vapidPrivateKey: "test-private",
    vapidSubject: "mailto:admin@example.test",
  });
  const subscription = await validDeviceSubscription();
  await f.call(alice, "pushSubscribe", { subscription });
  f.config.siteUrl = "https://zimnykurz.sk/priprava";
  let status = await f.call(alice, "pushStatus", {
    endpoint: subscription.endpoint,
  });
  assert.equal(status.subscribed, false);
  assert.equal(status.reenrollRequired, true);
  assert.equal(f.db.count("subscriptions"), 0);
  await f.call(alice, "pushSubscribe", { subscription });
  status = await f.call(alice, "pushStatus", {
    endpoint: subscription.endpoint,
  });
  assert.equal(status.subscribed, true);
  const row = f.db.sqlite
    .prepare("SELECT data FROM subscriptions WHERE endpoint=?")
    .get(subscription.endpoint) as { data: string };
  assert.equal(
    JSON.parse(row.data).applicationUrl,
    "https://zimnykurz.sk/priprava",
  );
  f.config.siteUrl = "https://zimnykurz.sk/another-path";
  assert.equal(
    (await f.call(alice, "pushStatus", { endpoint: subscription.endpoint }))
      .subscribed,
    false,
  );
});

test("legacy unscoped subscriptions expire safely and status checks cannot delete another member’s device", async (t) => {
  const f = await fixture(t);
  Object.assign(f.config, {
    siteUrl: "https://hub.biketrek.sk/zk",
    vapidPublicKey: "test-public",
    vapidPrivateKey: "test-private",
    vapidSubject: "mailto:admin@example.test",
  });
  const subscription = await validDeviceSubscription();
  await f.call(alice, "pushSubscribe", { subscription });
  f.db.sqlite
    .prepare("UPDATE subscriptions SET data=? WHERE endpoint=?")
    .run(JSON.stringify(subscription), subscription.endpoint);
  assert.equal(
    (await f.call(bob, "pushStatus", { endpoint: subscription.endpoint }))
      .subscribed,
    false,
  );
  assert.equal(f.db.count("subscriptions"), 1);
  assert.equal(
    (await f.call(alice, "pushStatus", { endpoint: subscription.endpoint }))
      .subscribed,
    false,
  );
  assert.equal(f.db.count("subscriptions"), 0);
  f.config.siteUrl = undefined;
  assert.equal(
    (
      await f.request(alice, "/api/action", {
        action: "pushSubscribe",
        subscription,
      })
    ).status,
    503,
  );
  assert.equal(f.db.count("subscriptions"), 0);
});

const csvDatasets = [
  "activities",
  "members",
  "awards",
  "challenges",
  "completions",
  "announcements",
  "recipients",
  "comments",
  "reactions",
];

test("every CSV dataset is organizer-only and unknown/private datasets are rejected", async (t) => {
  const f = await fixture(t);
  for (const dataset of csvDatasets) {
    assert.equal(
      (await f.request(alice, `/api/export.csv?dataset=${dataset}`)).status,
      403,
      dataset,
    );
    assert.equal(
      (await f.request(null, `/api/export.csv?dataset=${dataset}`)).status,
      401,
      dataset,
    );
    const response = await f.request(
      admin,
      `/api/export.csv?dataset=${dataset}`,
    );
    assert.equal(response.status, 200, dataset);
    assert.match(response.headers.get("cache-control") || "", /no-store/);
    assert.match(response.headers.get("content-type") || "", /text\/csv/);
  }
  for (const dataset of [
    "subscriptions",
    "sessions",
    "verification",
    "outbox",
    "../members",
    "members;DROP TABLE members",
  ])
    assert.equal(
      (
        await f.request(
          admin,
          `/api/export.csv?dataset=${encodeURIComponent(dataset)}`,
        )
      ).status,
      400,
      dataset,
    );
});

test("CSV datasets cover retained course history and neutralize spreadsheet formulas without exporting secrets", async (t) => {
  const f = await fixture(t);
  await f.call(alice, "saveProfile", {
    nickname: "=CSV_NAME",
    animations: true,
  });
  const activity = await f.activity(alice, { note: "=CSV_ACTIVITY" });
  await f.call(alice, "saveComment", {
    activityId: activity.id,
    body: "=CSV_COMMENT",
  });
  await f.call(alice, "reaction", { activityId: activity.id });
  await f.call(alice, "completeGear", {
    completed: true,
    note: "=CSV_COMPLETION",
  });
  await f.call(admin, "saveChallenge", {
    name: "=CSV_CHALLENGE",
    description: "=CSV_DESCRIPTION",
    startDate: "2026-10-19",
    endDate: "2026-10-25",
    condition: { kind: "manual", count: 1 },
    reward: "Bonus",
    hidden: false,
  });
  const me = (await f.getState(alice)).me;
  const message = await f.call(admin, "saveMessage", {
    title: "=CSV_MESSAGE",
    body: "=CSV_BODY",
    link: "",
    important: false,
    pinned: false,
    audience: "selected",
    recipients: [me.id],
    push: false,
  });
  await f.call(admin, "sendMessage", { id: message.id });
  f.db.sqlite
    .prepare(
      "INSERT INTO subscriptions(id,course_id,member_id,endpoint,data,created_at) VALUES(?,?,?,?,?,?)",
    )
    .run(
      "private-device",
      me.courseId,
      me.id,
      "https://fcm.googleapis.com/PRIVATE_ENDPOINT_SENTINEL",
      JSON.stringify({ private: "PUSH_KEY_SENTINEL" }),
      "2026-10-25T12:00:00Z",
    );
  for (const dataset of csvDatasets) {
    const response = await f.request(
      admin,
      `/api/export.csv?dataset=${dataset}`,
    );
    assert.equal(response.status, 200, dataset);
    const csv = await response.text();
    assert.ok(
      csv.includes("\"'=CSV_"),
      `${dataset} must protect its formula-valued text`,
    );
    assert.ok(!csv.includes('"=CSV_'), dataset);
    assert.ok(!csv.includes("PRIVATE_ENDPOINT_SENTINEL"), dataset);
    assert.ok(!csv.includes("PUSH_KEY_SENTINEL"), dataset);
    if (dataset === "members")
      assert.ok(
        csv.includes(alice.email),
        "organizer export includes member email",
      );
    if (dataset === "challenges")
      assert.ok(
        csv.includes("Studená sprcha"),
        "organizer can export hidden drafts",
      );
    if (dataset === "awards")
      assert.ok(csv.includes("Snapshot pravidla (JSON)"));
  }
  // Imported leading whitespace must not bypass formula protection either.
  f.db.sqlite
    .prepare("UPDATE comments SET body=? WHERE activity_id=?")
    .run("\t=CSV_IMPORTED", activity.id);
  assert.ok(
    (
      await (await f.request(admin, "/api/export.csv?dataset=comments")).text()
    ).includes('"\'\t=CSV_IMPORTED"'),
  );
  await f.call(admin, "updateMember", { id: me.id, active: false });
  assert.ok(
    (await (await f.request(admin, "/api/export.csv")).text()).includes(
      "CSV_ACTIVITY",
    ),
    "default export preserves inactive member history",
  );
  assert.ok(
    (
      await (await f.request(admin, "/api/export.csv?dataset=awards")).text()
    ).includes("CSV_NAME"),
    "inactive member earned awards remain exportable",
  );
});

test("all CSV datasets stay inside the selected course, including linked comments and recipients", async (t) => {
  const f = await fixture(t);
  const otherConfig = { ...f.config, courseId: "other-export-course" };
  async function other(body?: Record<string, unknown>) {
    const response = await handleRequest(
      new Request(`${origin}${body ? "/api/action" : "/api/state"}`, {
        method: body ? "POST" : "GET",
        headers: body ? { "content-type": "application/json", origin } : {},
        body: body ? JSON.stringify(body) : undefined,
      }),
      admin,
      f.db,
      otherConfig,
    );
    const result = (await response.json()) as any;
    assert.equal(response.status, 200, JSON.stringify(result));
    return result;
  }
  const otherState = await other();
  const marker = "OTHER_COURSE_PRIVATE";
  await other({ action: "saveProfile", nickname: marker, animations: true });
  const activity = await other({
    action: "saveActivity",
    idempotencyKey: "other-course-export",
    typeId: otherState.types.find((type: any) => type.group === "foot").id,
    date: "2026-10-20",
    minutes: 30,
    distance: null,
    note: marker,
  });
  await other({ action: "saveComment", activityId: activity.id, body: marker });
  await other({ action: "reaction", activityId: activity.id });
  await other({ action: "completeGear", completed: true, note: marker });
  await other({
    action: "saveChallenge",
    name: marker,
    description: marker,
    startDate: "2026-10-19",
    endDate: "2026-10-25",
    condition: { kind: "manual", count: 1 },
    reward: "Bonus",
    hidden: false,
  });
  const message = await other({
    action: "saveMessage",
    title: marker,
    body: marker,
    link: "",
    important: false,
    pinned: false,
    audience: "all",
    recipients: [],
    push: false,
  });
  await other({ action: "sendMessage", id: message.id });
  for (const dataset of csvDatasets) {
    const response = await f.request(
      admin,
      `/api/export.csv?dataset=${dataset}`,
    );
    assert.equal(response.status, 200, dataset);
    const csv = await response.text();
    assert.ok(!csv.includes(marker), dataset);
    assert.ok(!csv.includes(otherState.me.id), dataset);
    assert.ok(!csv.includes(activity.id), dataset);
    assert.ok(!csv.includes(message.id), dataset);
  }
});
