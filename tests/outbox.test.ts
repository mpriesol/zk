import test from "node:test";
import assert from "node:assert/strict";
import { TestDatabase } from "./helpers.ts";
import { drainOutbox } from "../lib/outbox.ts";
import { one, run } from "../lib/database.ts";

const b64 = (bytes: ArrayBuffer | Uint8Array) =>
  Buffer.from(
    bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes),
  ).toString("base64url");
async function fixture(t: test.TestContext, devices = 2) {
  const db = new TestDatabase();
  t.after(() => db.close());
  let clock = new Date("2026-10-25T12:00:00Z");
  const key = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  const jwk = await crypto.subtle.exportKey("jwk", key.privateKey);
  const config = {
    now: () => clock,
    siteUrl: "https://example.test/priprava",
    vapidSubject: "mailto:admin@example.test",
    vapidPublicKey: b64(await crypto.subtle.exportKey("raw", key.publicKey)),
    vapidPrivateKey: jwk.d!,
    emailApiKey: "test-only",
    emailFrom: "test@example.test",
  };
  await run(
    db,
    "INSERT INTO courses(id,data) VALUES(?,?)",
    "c",
    JSON.stringify({ name: "Testovací kurz" }),
  );
  await run(
    db,
    "INSERT INTO members(id,course_id,user_id,email,nickname,role,active,animations,joined_at) VALUES(?,?,?,?,?,?,1,1,?)",
    "m",
    "c",
    "u",
    "m@example.test",
    "Miro",
    "participant",
    clock.toISOString(),
  );
  await run(
    db,
    "INSERT INTO messages(id,course_id,data,status,created_at,sent_at) VALUES(?,?,?,?,?,?)",
    "msg",
    "c",
    "{}",
    "sent",
    clock.toISOString(),
    clock.toISOString(),
  );
  await run(
    db,
    "INSERT INTO recipients(id,message_id,member_id) VALUES(?,?,?)",
    "recipient",
    "msg",
    "m",
  );
  for (let i = 0; i < devices; i++) {
    const key = await crypto.subtle.generateKey(
      { name: "ECDH", namedCurve: "P-256" },
      true,
      ["deriveBits"],
    );
    const subscription = {
      endpoint: `https://fcm.googleapis.com/fcm/send/device${i}`,
      expirationTime: null,
      applicationUrl: config.siteUrl,
      keys: {
        p256dh: b64(await crypto.subtle.exportKey("raw", key.publicKey)),
        auth: b64(crypto.getRandomValues(new Uint8Array(16))),
      },
    };
    await run(
      db,
      "INSERT INTO subscriptions(id,course_id,member_id,endpoint,data,created_at) VALUES(?,?,?,?,?,?)",
      `s${i}`,
      "c",
      "m",
      subscription.endpoint,
      JSON.stringify(subscription),
      clock.toISOString(),
    );
  }
  const add = async (id = "job", kind = "push", reference = "msg") =>
    run(
      db,
      "INSERT INTO outbox(id,course_id,member_id,kind,reference_id,payload,status,attempts,next_attempt,created_at) VALUES(?,?,?,?,?,?,'pending',0,?,?)",
      id,
      "c",
      "m",
      kind,
      reference,
      JSON.stringify(kind === "email" ? { to: "m@example.test" } : {}),
      clock.toISOString(),
      clock.toISOString(),
    );
  await add();
  return {
    db,
    config,
    add,
    setNow: (value: string) => {
      clock = new Date(value);
    },
    job: () => one(db, "SELECT * FROM outbox WHERE id=?", "job"),
  };
}

test("retry sends only unfinished devices; receipts persist and repeat drain is idempotent", async (t) => {
  const f = await fixture(t);
  const calls: string[] = [];
  let failSecond = true;
  const transport = (async (url: string | URL | Request) => {
    const s = String(url);
    calls.push(s);
    return new Response(null, {
      status: s.endsWith("device1") && failSecond ? 503 : 201,
    });
  }) as typeof fetch;
  let result = await drainOutbox(f.db, f.config, transport);
  assert.equal(result.retried, 1);
  assert.equal(calls.length, 2);
  let job = await f.job();
  assert.equal(job.status, "pending");
  assert.equal(JSON.parse(job.payload)._deliveries.s0.status, "accepted");
  assert.equal(
    (await drainOutbox(f.db, f.config, transport)).processed,
    0,
    "future retry must wait",
  );
  f.setNow("2026-10-25T12:02:00Z");
  failSecond = false;
  result = await drainOutbox(f.db, f.config, transport);
  assert.equal(result.accepted, 1);
  assert.equal(calls.filter((u) => u.endsWith("device0")).length, 1);
  assert.equal(calls.filter((u) => u.endsWith("device1")).length, 2);
  assert.equal((await f.job()).status, "accepted");
  assert.equal((await drainOutbox(f.db, f.config, transport)).processed, 0);
});

test("concurrent drains claim a job once", async (t) => {
  const f = await fixture(t, 1);
  let calls = 0;
  const transport = (async () => {
    calls++;
    await new Promise((resolve) => setTimeout(resolve, 20));
    return new Response(null, { status: 201 });
  }) as typeof fetch;
  await Promise.all([
    drainOutbox(f.db, f.config, transport),
    drainOutbox(f.db, f.config, transport),
  ]);
  assert.equal(calls, 1);
  assert.equal((await f.job()).attempts, 1);
});

test("revoked members and non-recipients never receive queued content", async (t) => {
  const f = await fixture(t);
  let calls = 0;
  const transport = (async () => {
    calls++;
    return new Response(null, { status: 201 });
  }) as typeof fetch;
  await run(f.db, "UPDATE members SET active=0 WHERE id=?", "m");
  assert.equal((await drainOutbox(f.db, f.config, transport)).cancelled, 1);
  assert.equal(calls, 0);
  await run(f.db, "UPDATE members SET active=1 WHERE id=?", "m");
  await run(f.db, "UPDATE outbox SET status='pending' WHERE id='job'");
  await run(f.db, "DELETE FROM recipients WHERE id='recipient'");
  assert.equal((await drainOutbox(f.db, f.config, transport)).cancelled, 1);
  assert.equal(calls, 0);
});

test("expired subscriptions are deleted and devices added later do not receive an old notification", async (t) => {
  const f = await fixture(t, 1);
  let calls = 0;
  const result = await drainOutbox(f.db, f.config, (async () => {
    calls++;
    return new Response(null, { status: 410 });
  }) as typeof fetch);
  assert.equal(result.skipped, 1);
  assert.equal(f.db.count("subscriptions"), 0);
  assert.equal(calls, 1);
  assert.equal((await f.job()).status, "skipped");
});

test("crashed lease reclaims and retries stop after eight attempts", async (t) => {
  const f = await fixture(t, 1);
  await run(
    f.db,
    "UPDATE outbox SET status='processing',attempts=7,next_attempt=? WHERE id='job'",
    "2026-10-25T11:00:00Z",
  );
  const result = await drainOutbox(
    f.db,
    f.config,
    (async () => new Response(null, { status: 503 })) as typeof fetch,
  );
  assert.equal(result.failed, 1);
  assert.equal((await f.job()).attempts, 8);
  assert.equal((await f.job()).status, "failed");
});

test("email jobs use stable provider idempotency key and require configured sender", async (t) => {
  const f = await fixture(t, 0);
  await run(f.db, "DELETE FROM outbox");
  await f.add("mail", "email", "invite");
  let key = "";
  const result = await drainOutbox(f.db, f.config, (async (_url, options) => {
    key = new Headers(options?.headers).get("idempotency-key") || "";
    return new Response(null, { status: 200 });
  }) as typeof fetch);
  assert.equal(result.accepted, 1);
  assert.equal(key, "cz-invite-mail");
  await f.add("mail2", "email", "invite2");
  let calls = 0;
  const missing = await drainOutbox(
    f.db,
    { ...f.config, emailApiKey: "" },
    (async () => {
      calls++;
      return new Response(null, { status: 200 });
    }) as typeof fetch,
  );
  assert.equal(missing.failed, 1);
  assert.equal(calls, 0);
});

test("self-host SMTP callback receives exact member and stable job id; HTTP email fallback is unused", async (t) => {
  const f = await fixture(t, 0);
  await run(f.db, "DELETE FROM outbox");
  await f.add("smtp", "email", "smtp-invite");
  const seen: any[] = [];
  const result = await drainOutbox(
    f.db,
    {
      ...f.config,
      invitationSender: async (payload) => {
        seen.push(payload);
        return { status: "accepted", httpStatus: 250 };
      },
    },
    (async () => {
      throw new Error("Unexpected HTTP");
    }) as typeof fetch,
  );
  assert.equal(result.accepted, 1);
  assert.equal(seen.length, 1);
  assert.deepEqual(seen[0], {
    to: "m@example.test",
    nickname: "Miro",
    courseName: "Testovací kurz",
    idempotencyKey: "cz-invite-smtp",
    siteUrl: "https://example.test/priprava",
  });
});

test("switching origin or prefix removes old subscriptions without sending from the new application", async (t) => {
  const f = await fixture(t, 2);
  const old = await one(
    f.db,
    "SELECT data FROM subscriptions WHERE id=?",
    "s0",
  );
  await run(
    f.db,
    "UPDATE subscriptions SET data=? WHERE id=?",
    JSON.stringify({
      ...JSON.parse(old.data),
      applicationUrl: "https://hub.biketrek.sk/zk",
    }),
    "s0",
  );
  const other = await one(
    f.db,
    "SELECT data FROM subscriptions WHERE id=?",
    "s1",
  );
  await run(
    f.db,
    "UPDATE subscriptions SET data=? WHERE id=?",
    JSON.stringify({
      ...JSON.parse(other.data),
      applicationUrl: "https://example.test/zk",
    }),
    "s1",
  );
  let calls = 0;
  const result = await drainOutbox(f.db, f.config, (async () => {
    calls++;
    return new Response(null, { status: 201 });
  }) as typeof fetch);
  assert.equal(result.skipped, 1);
  assert.equal(calls, 0);
  assert.equal(f.db.count("subscriptions"), 0);
});

test("legacy unscoped subscription requires explicit re-enrolment and never receives new-origin push", async (t) => {
  const f = await fixture(t, 1);
  const old = await one(
    f.db,
    "SELECT data FROM subscriptions WHERE id=?",
    "s0",
  );
  const value = JSON.parse(old.data);
  delete value.applicationUrl;
  await run(
    f.db,
    "UPDATE subscriptions SET data=? WHERE id=?",
    JSON.stringify(value),
    "s0",
  );
  let calls = 0;
  const result = await drainOutbox(f.db, f.config, (async () => {
    calls++;
    return new Response(null, { status: 201 });
  }) as typeof fetch);
  assert.equal(result.skipped, 1);
  assert.equal(calls, 0);
  assert.equal(f.db.count("subscriptions"), 0);
});
