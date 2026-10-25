import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { SQLiteDatabase, migrateApp } from "../server/sqlite.ts";
import {
  authSettingsFromEnv,
  createAuth,
  migrateAuth,
  type Mail,
} from "../server/auth.ts";
import { createInitialPasswordAdmin } from "../server/accounts.ts";
import { createApiHandler } from "../server/start.ts";
import { queuedDatabase } from "../server/database-queue.ts";

const appUrl = "https://hub.biketrek.sk/zk";
const origin = "https://hub.biketrek.sk";
const adminName = "test_admin";
const password = "Isolated test password 24!";
const newPassword = "Different test password 57!";
const secret = "password-test-only-secret-not-used-in-production-0123456789";
const baseEnv: NodeJS.ProcessEnv = {
  NODE_ENV: "production",
  APP_URL: appUrl,
  BETTER_AUTH_SECRET: secret,
  COURSE_ID: "password-test",
  AUTH_MODE: "password",
  REGISTRATION_OPEN: "true",
  BOOTSTRAP_ADMIN_EMAIL: "contact@example.test",
};
let ipIndex = 1;
function req(
  path: string,
  body?: unknown,
  cookie = "",
  extra: Record<string, string> = {},
) {
  return new Request(appUrl + path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      origin,
      "content-type": "application/json",
      "x-real-ip": `192.0.2.${(ipIndex++ % 250) + 1}`,
      ...(cookie ? { cookie } : {}),
      ...extra,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
function cookieOf(response: Response) {
  return response.headers
    .getSetCookie()
    .map((v) => v.split(";")[0])
    .join("; ");
}
async function bodyOf(response: Response) {
  assert.ok(
    response.ok,
    `HTTP ${response.status}: ${await response.clone().text()}`,
  );
  return response.json();
}
function tokenOf(url: string, kind: "invite" | "reset") {
  const parsed = new URL(url);
  assert.equal(parsed.origin, origin);
  assert.equal(
    parsed.searchParams.has(kind),
    false,
    "secrets belong in a fragment, not query/referrer",
  );
  const token = new URLSearchParams(parsed.hash.slice(1)).get(kind);
  assert.ok(token && token.length >= 32, "unguessable token in URL fragment");
  return token;
}
async function fixture(overrides: NodeJS.ProcessEnv = {}) {
  const directory = mkdtempSync(join(tmpdir(), "cz-password-"));
  const file = join(directory, "app.sqlite");
  const settings = authSettingsFromEnv({ ...baseEnv, ...overrides });
  const captured: Mail[] = [];
  let db = new SQLiteDatabase(file);
  migrateApp(db);
  let auth = createAuth(db, settings, async (mail) => {
    captured.push(mail);
  });
  await migrateAuth(auth);
  await createInitialPasswordAdmin(db, auth, settings, {
    username: adminName,
    password,
  });
  const config = {
    siteUrl: settings.appUrl,
    courseId: settings.courseId,
    bootstrapAdminEmail: settings.bootstrapAdminEmail,
    emailEnabled: false,
  };
  let api = createApiHandler(db, auth, config);
  const call = (
    path: string,
    body?: unknown,
    cookie = "",
    extra: Record<string, string> = {},
  ) => api(req(path, body, cookie, extra));
  const signin = (username: string, pw = password) =>
    call("/api/auth/sign-in/username", { username, password: pw });
  const register = (
    username: string,
    inviteToken?: string,
    extra: Record<string, unknown> = {},
  ) =>
    call("/api/register", {
      username,
      password,
      ...(inviteToken ? { inviteToken } : {}),
      ...extra,
    });
  const adminLogin = await signin(adminName);
  assert.equal(adminLogin.status, 200, await adminLogin.clone().text());
  const adminCookie = cookieOf(adminLogin);
  const management = () =>
    call("/api/registration/admin", undefined, adminCookie).then(bodyOf);
  const adminAction = (action: string, fields: Record<string, unknown> = {}) =>
    call("/api/registration/admin", { action, ...fields }, adminCookie);
  const invite = async (maxUses = 1) => {
    const label = "Test " + randomUUID();
    const created = await bodyOf(
      await adminAction("createInvite", { label, maxUses, expiresInDays: 1 }),
    );
    const token = tokenOf(created.url, "invite");
    const listed = await management();
    const entry = listed.invites.find((i: any) => i.label === label);
    assert.ok(entry);
    return { token, id: entry.id, url: created.url };
  };
  const approved = async (username: string) => {
    const registered = await register(username);
    assert.ok(registered.ok, await registered.clone().text());
    const cookie = cookieOf(registered);
    const pending = (await management()).pending.find(
      (p: any) => p.username.toLowerCase() === username.toLowerCase(),
    );
    assert.ok(pending, "new account waits for approval");
    await bodyOf(await adminAction("approve", { id: pending.id }));
    const state = await bodyOf(await call("/api/state", undefined, cookie));
    return {
      cookie,
      memberId: state.me.id,
      userId: pending.userId,
      pendingId: pending.id,
    };
  };
  return {
    get db() {
      return db;
    },
    get auth() {
      return auth;
    },
    settings,
    config,
    directory,
    file,
    captured,
    call,
    signin,
    register,
    adminCookie,
    management,
    adminAction,
    invite,
    approved,
    async reopen() {
      db.close();
      db = new SQLiteDatabase(file);
      migrateApp(db);
      auth = createAuth(db, settings, async (mail) => {
        captured.push(mail);
      });
      await migrateAuth(auth);
      api = createApiHandler(db, auth, config);
    },
    close() {
      db.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

// These tests use real Better Auth credentials/cookies and actual SQLite, not injected identities.
test("password mode is the default and starts without SMTP; email modes retain production SMTP requirements", () => {
  const defaultSettings = authSettingsFromEnv({
    ...baseEnv,
    AUTH_MODE: undefined,
  });
  assert.equal(defaultSettings.authMode, "password");
  assert.equal(defaultSettings.smtpHost, undefined);
  assert.throws(
    () => authSettingsFromEnv({ ...baseEnv, AUTH_MODE: "email" }),
    /SMTP/,
  );
  assert.throws(
    () => authSettingsFromEnv({ ...baseEnv, AUTH_MODE: "both" }),
    /SMTP/,
  );
  assert.throws(() =>
    authSettingsFromEnv({ ...baseEnv, AUTH_MODE: "unknown" }),
  );
  assert.throws(() =>
    authSettingsFromEnv({ ...baseEnv, AUTH_MAIL_MODE: "file" }),
  );
  assert.throws(
    () =>
      authSettingsFromEnv({ ...baseEnv, APP_URL: "http://hub.biketrek.sk/zk" }),
    /HTTPS/,
  );
});

test("public auth options advertise only available methods, never secrets or bootstrap identity", async () => {
  const f = await fixture();
  try {
    const r = await f.call("/api/auth-options");
    const text = await r.text();
    assert.equal(r.status, 200);
    assert.deepEqual(JSON.parse(text), {
      password: true,
      emailOtp: false,
      registrationOpen: true,
    });
    assert.match(r.headers.get("cache-control") || "", /no-store/);
    for (const value of [secret, password, baseEnv.BOOTSTRAP_ADMIN_EMAIL!])
      assert.equal(text.includes(value), false);
  } finally {
    f.close();
  }
});

test("trusted bootstrap creates an admin once; public signup cannot choose its own role", async () => {
  const f = await fixture();
  try {
    const admin = await bodyOf(
      await f.call("/api/state", undefined, f.adminCookie),
    );
    assert.equal(admin.me.role, "admin");
    await assert.rejects(
      createInitialPasswordAdmin(f.db, f.auth, f.settings, {
        username: "second_admin",
        password,
      }),
    );
    const registration = await f.register("public_person", undefined, {
      role: "admin",
      memberId: admin.me.id,
      courseId: "different",
    });
    const result = await bodyOf(registration);
    assert.equal(result.membership, "pending");
    assert.equal(
      (await f.call("/api/state", undefined, cookieOf(registration))).status,
      403,
    );
    assert.equal(
      (
        await f.call(
          "/api/registration/admin",
          undefined,
          cookieOf(registration),
        )
      ).status,
      403,
    );
  } finally {
    f.close();
  }
});

test("uninvited registration issues a persistent protected cookie but cannot read group data before approval", async () => {
  const f = await fixture();
  try {
    const r = await f.register("waiting_person");
    const data = await bodyOf(r);
    assert.equal(data.membership, "pending");
    const headers = r.headers.getSetCookie().join(";");
    assert.match(headers, /HttpOnly/i);
    assert.match(headers, /Secure/i);
    assert.match(headers, /SameSite=Lax/i);
    assert.match(headers, /Path=\/zk(?:;|$)/i);
    assert.match(headers, /Max-Age=2592000/i);
    const cookie = cookieOf(r);
    const account = await bodyOf(
      await f.call("/api/account", undefined, cookie),
    );
    assert.equal(account.username, "waiting_person");
    assert.equal(account.hasPassword, true);
    assert.equal(account.membership, "pending");
    for (const path of ["/api/state", "/api/admin", "/api/export.csv"])
      assert.equal((await f.call(path, undefined, cookie)).status, 403);
    assert.equal((await f.call("/api/state")).status, 401);
  } finally {
    f.close();
  }
});

test("admin approval activates only the chosen request and preserves its original session", async () => {
  const f = await fixture();
  try {
    const first = await f.register("waiting_first");
    const second = await f.register("waiting_second");
    const rows = (await f.management()).pending;
    const firstRow = rows.find((r: any) => r.username === "waiting_first");
    assert.ok(firstRow);
    await bodyOf(
      await f.adminAction("approve", { id: firstRow.id, role: "admin" }),
    );
    const state = await bodyOf(
      await f.call("/api/state", undefined, cookieOf(first)),
    );
    assert.equal(state.me.role, "participant");
    assert.equal(
      (await f.call("/api/state", undefined, cookieOf(second))).status,
      403,
    );
  } finally {
    f.close();
  }
});

test("rejected requests cannot reactivate themselves with a generic invitation", async () => {
  const f = await fixture();
  try {
    const r = await f.register("rejected_person");
    const cookie = cookieOf(r);
    const row = (await f.management()).pending.find(
      (p: any) => p.username === "rejected_person",
    );
    await bodyOf(await f.adminAction("reject", { id: row.id }));
    const invitation = await f.invite();
    assert.ok(
      (
        await f.call(
          "/api/invites/accept",
          { inviteToken: invitation.token },
          cookie,
        )
      ).status >= 400,
    );
    assert.equal((await f.call("/api/state", undefined, cookie)).status, 403);
    assert.ok(
      (await f.register("REJECTED_PERSON", invitation.token)).status >= 400,
    );
  } finally {
    f.close();
  }
});

test("valid invite grants participant membership and only an admin can issue or revoke invitations", async () => {
  const f = await fixture();
  try {
    const invitation = await f.invite();
    const registered = await f.register("invited_person", invitation.token, {
      role: "admin",
    });
    assert.equal((await bodyOf(registered)).membership, "active");
    const cookie = cookieOf(registered);
    const state = await bodyOf(await f.call("/api/state", undefined, cookie));
    assert.equal(state.me.role, "participant");
    for (const action of [
      "createInvite",
      "revokeInvite",
      "approve",
      "reject",
      "createReset",
    ])
      assert.equal(
        (
          await f.call(
            "/api/registration/admin",
            { action, id: invitation.id, memberId: state.me.id },
            cookie,
          )
        ).status,
        403,
      );
    const list = await f.management();
    assert.equal(list.invites.find((i: any) => i.id === invitation.id).uses, 1);
    assert.equal(
      JSON.stringify(list).includes(invitation.token),
      false,
      "raw token is shown only once on creation",
    );
  } finally {
    f.close();
  }
});

test("username login is case-insensitive and supports normalized Slovak names without requiring email", async () => {
  const f = await fixture();
  try {
    const invitation = await f.invite();
    const registered = await f.register("Ľubo Šťastný", invitation.token);
    await bodyOf(registered);
    const signed = await f.signin("  ľUBO   šŤASTNÝ  ");
    assert.equal(signed.status, 200, await signed.clone().text());
    const account = await bodyOf(
      await f.call("/api/account", undefined, cookieOf(signed)),
    );
    assert.equal(account.hasPassword, true);
    assert.ok((await f.register("ľubo šťastný")).status >= 400);
    assert.equal(f.captured.length, 0);
  } finally {
    f.close();
  }
});

test("invalid usernames and weak or overlong passwords cannot create accounts", async () => {
  const f = await fixture();
  try {
    const before = Number(
      f.db.native.prepare("SELECT COUNT(*) n FROM user").get()!.n,
    );
    for (const [username, pw] of [
      ["ab", password],
      ["x".repeat(33), password],
      ["bad<script>", password],
      ["valid_name", "short"],
      ["valid_name", "x".repeat(129)],
    ]) {
      const r = await f.register(username, undefined, { password: pw });
      assert.ok(r.status >= 400, username);
    }
    assert.equal(
      Number(f.db.native.prepare("SELECT COUNT(*) n FROM user").get()!.n),
      before,
    );
  } finally {
    f.close();
  }
});

test("real credential hashes differ from plaintext and wrong passwords never create sessions", async () => {
  const f = await fixture();
  try {
    const a = await f.approved("credential_person");
    const credentials = f.db.native
      .prepare("SELECT password FROM account WHERE userId=?")
      .all(a.userId);
    assert.ok(credentials.length > 0);
    assert.ok(
      credentials.every(
        (r) =>
          r.password &&
          r.password !== password &&
          !String(r.password).includes(password),
      ),
    );
    const bad = await f.signin("credential_person", "incorrect password");
    assert.ok(bad.status >= 400);
    assert.equal(cookieOf(bad), "");
    const absent = await f.signin("nonexistent_user", "incorrect password");
    assert.ok(absent.status >= 400);
    assert.equal(cookieOf(absent), "");
    assert.equal((await f.signin("credential_person")).status, 200);
  } finally {
    f.close();
  }
});

test("raw Better Auth signup and email password routes cannot bypass invite/approval policy", async () => {
  const f = await fixture();
  try {
    for (const path of [
      "/api/auth/sign-up/email",
      "/api/auth/sign-in/email",
      "/api/auth/forget-password",
      "/api/auth/reset-password",
    ]) {
      assert.equal(
        (
          await f.call(path, {
            email: "attacker@example.test",
            username: "attacker",
            password,
          })
        ).status,
        404,
      );
    }
    assert.equal(
      (
        await f.call("/api/auth/email-otp/send-verification-otp", {
          email: baseEnv.BOOTSTRAP_ADMIN_EMAIL,
          type: "sign-in",
        })
      ).status,
      404,
    );
    assert.equal(f.captured.length, 0);
  } finally {
    f.close();
  }
});

test("cross-origin registration, invitation and reset requests are denied before changing data", async () => {
  const f = await fixture();
  try {
    const foreign = { origin: "https://attacker.example" };
    assert.equal(
      (
        await f.call(
          "/api/register",
          { username: "cross_origin", password },
          "",
          foreign,
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await f.call(
          "/api/registration/admin",
          { action: "createInvite" },
          f.adminCookie,
          foreign,
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await f.call(
          "/api/password/reset",
          { token: "x".repeat(48), newPassword },
          "",
          foreign,
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await f.call(
          "/api/register",
          { username: "missing_origin", password },
          "",
          { origin: "" },
        )
      ).status,
      403,
    );
    assert.equal((await f.management()).pending.length, 0);
    assert.equal((await f.management()).invites.length, 0);
  } finally {
    f.close();
  }
});

test("one-use invitation cannot activate two concurrent registrations", async () => {
  const f = await fixture();
  try {
    const invitation = await f.invite(1);
    const responses = await Promise.all([
      f.register("racer_one", invitation.token),
      f.register("racer_two", invitation.token),
    ]);
    const bodies = await Promise.all(
      responses.map(async (r) => (r.ok ? r.json() : null)),
    );
    assert.equal(bodies.filter((b) => b?.membership === "active").length, 1);
    assert.equal(
      (await f.management()).invites.find((i: any) => i.id === invitation.id)
        .uses,
      1,
    );
    for (let i = 0; i < responses.length; i++)
      if (bodies[i]?.membership !== "active")
        assert.ok(
          (await f.call("/api/state", undefined, cookieOf(responses[i])))
            .status >= 400,
        );
  } finally {
    f.close();
  }
});

test("duplicate case-folded usernames submitted concurrently create at most one account", async () => {
  const f = await fixture();
  try {
    const responses = await Promise.all([
      f.register("Duplicate_Name"),
      f.register("duplicate_name"),
    ]);
    assert.equal(
      responses.filter((r) => r.ok).length,
      1,
      JSON.stringify(
        await Promise.all(
          responses.map(async (r) => ({
            status: r.status,
            body: await r.clone().text(),
          })),
        ),
      ),
    );
    const pending = (await f.management()).pending.filter(
      (p: any) => p.username.toLowerCase() === "duplicate_name",
    );
    assert.equal(pending.length, 1);
  } finally {
    f.close();
  }
});

test("revoked or fabricated invitations do not grant membership", async () => {
  const f = await fixture();
  try {
    const invitation = await f.invite();
    await bodyOf(await f.adminAction("revokeInvite", { id: invitation.id }));
    assert.ok(
      (await f.register("revoked_invite", invitation.token)).status >= 400,
    );
    assert.ok((await f.register("fake_invite", "z".repeat(64))).status >= 400);
  } finally {
    f.close();
  }
});

test("pending user can accept a valid invite only for their own account", async () => {
  const f = await fixture();
  try {
    const first = await f.register("pending_accept");
    const second = await f.register("pending_other");
    const firstCookie = cookieOf(first),
      secondCookie = cookieOf(second);
    const invitation = await f.invite();
    await bodyOf(
      await f.call(
        "/api/invites/accept",
        {
          inviteToken: invitation.token,
          userId: "someone_else",
          role: "admin",
        },
        firstCookie,
      ),
    );
    const state = await bodyOf(
      await f.call("/api/state", undefined, firstCookie),
    );
    assert.equal(state.me.role, "participant");
    assert.equal(
      (await f.call("/api/state", undefined, secondCookie)).status,
      403,
    );
  } finally {
    f.close();
  }
});

test("session survives database reopen and daily renewal keeps the same user", async () => {
  const f = await fixture();
  try {
    const a = await f.approved("persistent_person");
    const before = await bodyOf(
      await f.call("/api/state", undefined, a.cookie),
    );
    await f.reopen();
    const reopened = await bodyOf(
      await f.call("/api/state", undefined, a.cookie),
    );
    assert.equal(reopened.me.id, before.me.id);
    const expiredSoon = Date.now() + 20 * 86400000;
    f.db.native
      .prepare("UPDATE session SET updatedAt=?,expiresAt=? WHERE userId=?")
      .run(Date.now() - 2 * 86400000, expiredSoon, a.userId);
    const refreshed = await f.call("/api/account", undefined, a.cookie);
    await bodyOf(refreshed);
    const session = f.db.native
      .prepare(
        "SELECT expiresAt FROM session WHERE userId=? ORDER BY expiresAt DESC",
      )
      .get(a.userId)!;
    assert.ok(
      (typeof session.expiresAt === "number"
        ? session.expiresAt
        : Date.parse(String(session.expiresAt))) > expiredSoon,
      `Refreshed expiry: ${session.expiresAt}`,
    );
    assert.equal(
      (await bodyOf(await f.call("/api/state", undefined, a.cookie))).me.id,
      before.me.id,
    );
  } finally {
    f.close();
  }
});

test("signout revokes the session and expired credentials cannot access group data", async () => {
  const f = await fixture();
  try {
    const a = await f.approved("logout_person");
    await bodyOf(await f.call("/api/auth/sign-out", {}, a.cookie));
    assert.equal((await f.call("/api/state", undefined, a.cookie)).status, 401);
    const login = await f.signin("logout_person");
    const cookie = cookieOf(login);
    f.db.native
      .prepare("UPDATE session SET expiresAt=? WHERE userId=?")
      .run(Date.now() - 1000, a.userId);
    assert.equal((await f.call("/api/state", undefined, cookie)).status, 401);
  } finally {
    f.close();
  }
});

test("revoking a member blocks existing sessions immediately and generic invites cannot undo it", async () => {
  const f = await fixture();
  try {
    const a = await f.approved("revoked_person");
    await bodyOf(
      await f.call(
        "/api/action",
        { action: "updateMember", id: a.memberId, active: false },
        f.adminCookie,
      ),
    );
    assert.equal((await f.call("/api/state", undefined, a.cookie)).status, 403);
    const invitation = await f.invite();
    assert.ok(
      (
        await f.call(
          "/api/invites/accept",
          { inviteToken: invitation.token },
          a.cookie,
        )
      ).status >= 400,
    );
    assert.equal((await f.call("/api/state", undefined, a.cookie)).status, 403);
  } finally {
    f.close();
  }
});

test("password reset is one-use, revokes every target session and leaves other members untouched", async () => {
  const f = await fixture();
  try {
    const a = await f.approved("reset_person");
    const other = await f.approved("unaffected_person");
    const second = await f.signin("reset_person");
    const secondCookie = cookieOf(second);
    const created = await bodyOf(
      await f.adminAction("createReset", { memberId: a.memberId }),
    );
    const token = tokenOf(created.url, "reset");
    assert.ok(
      (await f.call("/api/password/reset", { token, newPassword: "short" }))
        .status >= 400,
      "invalid password must not consume token",
    );
    await bodyOf(
      await f.call("/api/password/reset", {
        token,
        newPassword,
        userId: other.userId,
        memberId: other.memberId,
      }),
    );
    for (const cookie of [a.cookie, secondCookie])
      assert.equal((await f.call("/api/state", undefined, cookie)).status, 401);
    assert.equal(
      (await f.call("/api/state", undefined, other.cookie)).status,
      200,
    );
    assert.ok((await f.signin("reset_person")).status >= 400);
    assert.equal((await f.signin("reset_person", newPassword)).status, 200);
    assert.ok(
      (await f.call("/api/password/reset", { token, newPassword: password }))
        .status >= 400,
    );
    assert.equal((await f.signin("unaffected_person")).status, 200);
  } finally {
    f.close();
  }
});

test("reset links and invitation secrets are stored hashed and are absent from administrative listings", async () => {
  const f = await fixture();
  try {
    const a = await f.approved("secret_person");
    const invitation = await f.invite();
    const reset = await bodyOf(
      await f.adminAction("createReset", { memberId: a.memberId }),
    );
    const resetToken = tokenOf(reset.url, "reset");
    const admin = JSON.stringify(await f.management());
    assert.equal(admin.includes(invitation.token), false);
    assert.equal(admin.includes(resetToken), false);
    const tables = f.db.native
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
      )
      .all();
    for (const table of tables) {
      const name = String(table.name).replaceAll('"', '""');
      const data = JSON.stringify(
        f.db.native.prepare(`SELECT * FROM "${name}"`).all(),
      );
      assert.equal(
        data.includes(invitation.token),
        false,
        `raw invite token leaked in ${name}`,
      );
      assert.equal(
        data.includes(resetToken),
        false,
        `raw reset token leaked in ${name}`,
      );
    }
  } finally {
    f.close();
  }
});

test("synthetic password identities are never delivered by email or exposed in application/auth responses and CSV", async () => {
  const f = await fixture();
  try {
    const a = await f.approved("private_person");
    const synthetic = String(
      f.db.native.prepare("SELECT email FROM user WHERE id=?").get(a.userId)!
        .email,
    );
    const responses = await Promise.all([
      f.call("/api/state", undefined, a.cookie),
      f.call("/api/account", undefined, a.cookie),
      f.call("/api/auth/get-session", undefined, a.cookie),
      f.signin("private_person"),
      f.call("/api/export.csv?dataset=members", undefined, f.adminCookie),
    ]);
    for (const response of responses) {
      assert.equal(response.status, 200);
      assert.equal((await response.text()).includes(synthetic), false);
    }
    assert.equal(f.captured.length, 0);
  } finally {
    f.close();
  }
});

test("expired invitation and reset links fail without granting access or changing credentials", async () => {
  const f = await fixture();
  try {
    const invitation = await f.invite();
    f.db.native
      .prepare("UPDATE registration_invites SET expires_at=? WHERE id=?")
      .run(new Date(Date.now() - 1000).toISOString(), invitation.id);
    assert.ok(
      (await f.register("expired_invite_user", invitation.token)).status >= 400,
    );
    const a = await f.approved("expired_reset_user");
    const reset = await bodyOf(
      await f.adminAction("createReset", { memberId: a.memberId }),
    );
    f.db.native
      .prepare("UPDATE password_resets SET expires_at=? WHERE course_id=?")
      .run(new Date(Date.now() - 1000).toISOString(), f.settings.courseId);
    assert.ok(
      (
        await f.call("/api/password/reset", {
          token: tokenOf(reset.url, "reset"),
          newPassword,
        })
      ).status >= 400,
    );
    assert.equal((await f.signin("expired_reset_user")).status, 200);
  } finally {
    f.close();
  }
});

test("cross-course invitation, approval and reset identifiers cannot escape course scope", async () => {
  const f = await fixture();
  try {
    const state = await bodyOf(
      await f.call("/api/state", undefined, f.adminCookie),
    );
    f.db.native
      .prepare("INSERT INTO courses(id,data) VALUES(?,?)")
      .run(
        "other-course",
        JSON.stringify({ ...state.course, id: "other-course" }),
      );
    const invitation = await f.invite();
    f.db.native
      .prepare("UPDATE registration_invites SET course_id=? WHERE id=?")
      .run("other-course", invitation.id);
    assert.ok(
      (await f.register("foreign_invite_user", invitation.token)).status >= 400,
    );
    await bodyOf(await f.register("foreign_pending_user"));
    const pending = (await f.management()).pending.find(
      (p: any) => p.username === "foreign_pending_user",
    );
    f.db.native
      .prepare("UPDATE membership_requests SET course_id=? WHERE id=?")
      .run("other-course", pending.id);
    assert.ok(
      (await f.adminAction("approve", { id: pending.id })).status >= 400,
    );
    const a = await f.approved("foreign_member_user");
    const foreignId = "other-member";
    const own = f.db.native
      .prepare("SELECT * FROM members WHERE id=?")
      .get(a.memberId)!;
    f.db.native
      .prepare(
        "INSERT INTO members(id,course_id,user_id,email,nickname,role,active,animations,joined_at) VALUES(?,?,?,?,?,'participant',1,1,?)",
      )
      .run(
        foreignId,
        "other-course",
        a.userId,
        own.email,
        "Other",
        new Date().toISOString(),
      );
    assert.ok(
      (await f.adminAction("createReset", { memberId: foreignId })).status >=
        400,
    );
  } finally {
    f.close();
  }
});

test("custom registration rate limits persist in SQLite and reject unsafe content types", async () => {
  const f = await fixture();
  try {
    const fixedIp = { "x-real-ip": "198.51.100.91" };
    for (let i = 0; i < 5; i++)
      assert.ok(
        (
          await f.call(
            "/api/register",
            { username: `limited_${i}`, password },
            "",
            fixedIp,
          )
        ).ok,
      );
    assert.equal(
      (
        await f.call(
          "/api/register",
          { username: "limited_extra", password },
          "",
          fixedIp,
        )
      ).status,
      429,
    );
    await f.reopen();
    assert.equal(
      (
        await f.call(
          "/api/register",
          { username: "limited_after_restart", password },
          "",
          fixedIp,
        )
      ).status,
      429,
    );
    const unsafe = await f.call(
      "/api/register",
      { username: "unsafe_content_type", password },
      "",
      { "content-type": "text/plain" },
    );
    assert.ok(unsafe.status >= 400);
    const pending = (await f.management()).pending;
    assert.equal(
      pending.some((p: any) => p.username === "unsafe_content_type"),
      false,
    );
  } finally {
    f.close();
  }
});

test("optional full name stays private while other participants see only the chosen nickname", async () => {
  const f = await fixture();
  try {
    const privateName = "Súkromné Meno Testovacieho Človeka";
    const invitation = await f.invite();
    const registered = await f.register("public_nickname", invitation.token, {
      name: privateName,
    });
    const cookie = cookieOf(registered);
    await bodyOf(registered);
    const own = await bodyOf(await f.call("/api/state", undefined, cookie));
    assert.equal(own.me.nickname, "public_nickname");
    const activity = await bodyOf(
      await f.call(
        "/api/action",
        {
          action: "saveActivity",
          idempotencyKey: randomUUID(),
          typeId: own.types.find((type: any) => type.group === "foot").id,
          date: own.course.startDate,
          minutes: 35,
          distance: null,
          note: "Prechádzka v lese",
        },
        cookie,
      ),
    );
    await bodyOf(
      await f.call(
        "/api/action",
        {
          action: "saveComment",
          activityId: activity.id,
          body: "Dnes bolo príjemne.",
        },
        cookie,
      ),
    );
    const observer = await f.approved("observer_person");
    const response = await f.call("/api/state", undefined, observer.cookie);
    const text = await response.text();
    assert.equal(response.status, 200);
    assert.equal(text.includes(privateName), false);
    assert.ok(text.includes("public_nickname"));
    const observed = JSON.parse(text);
    const shared = observed.activities.find(
      (item: any) => item.id === activity.id,
    );
    assert.ok(
      shared,
      "the participant's activity is visible to another member",
    );
    assert.equal(shared.nickname, "public_nickname");
    assert.equal(shared.comments.length, 1);
    assert.equal(shared.comments[0].nickname, "public_nickname");
    assert.equal(shared.comments[0].body, "Dnes bolo príjemne.");
    const observerSession = await f.call(
      "/api/auth/get-session",
      undefined,
      observer.cookie,
    );
    assert.equal(observerSession.status, 200);
    assert.equal((await observerSession.text()).includes(privateName), false);
    const member = f.db.native
      .prepare("SELECT nickname FROM members WHERE id=?")
      .get(own.me.id)!;
    assert.equal(member.nickname, "public_nickname");
  } finally {
    f.close();
  }
});

test("both mode retains real email OTP for a linked real address but never sends to internal identities", async () => {
  const f = await fixture({
    AUTH_MODE: "both",
    SMTP_HOST: "smtp.example.test",
    MAIL_FROM: "test@example.test",
  });
  try {
    assert.deepEqual(await bodyOf(await f.call("/api/auth-options")), {
      password: true,
      emailOtp: true,
      registrationOpen: true,
    });
    const a = await f.approved("dual_internal_person");
    assert.equal(
      f.db.native
        .prepare(
          "SELECT user_id FROM operator_password_accounts WHERE user_id=?",
        )
        .get(a.userId),
      undefined,
      "public password registration never gains trusted operator provenance",
    );
    const synthetic = String(
      f.db.native.prepare("SELECT email FROM user WHERE id=?").get(a.userId)!
        .email,
    );
    await bodyOf(
      await f.call("/api/auth/email-otp/send-verification-otp", {
        email: synthetic,
        type: "sign-in",
      }),
    );
    assert.equal(f.captured.length, 0);
    const before = await bodyOf(
      await f.call("/api/state", undefined, f.adminCookie),
    );
    assert.equal(
      f.db.native
        .prepare("SELECT emailVerified FROM user WHERE username=?")
        .get(adminName)!.emailVerified,
      0,
      "local provisioning must not claim ownership of the configured mailbox",
    );
    await bodyOf(
      await f.call("/api/auth/email-otp/send-verification-otp", {
        email: baseEnv.BOOTSTRAP_ADMIN_EMAIL,
        type: "sign-in",
      }),
    );
    assert.equal(f.captured.length, 1);
    const otp = f.captured[0].text.match(/kód je (\d{6})/)![1];
    const signed = await f.call("/api/auth/sign-in/email-otp", {
      email: baseEnv.BOOTSTRAP_ADMIN_EMAIL,
      otp,
    });
    await bodyOf(signed);
    const after = await bodyOf(
      await f.call("/api/state", undefined, cookieOf(signed)),
    );
    assert.equal(after.me.id, before.me.id);
    assert.equal(
      f.db.native
        .prepare("SELECT emailVerified FROM user WHERE username=?")
        .get(adminName)!.emailVerified,
      1,
    );
    assert.equal(
      (await f.call("/api/state", undefined, f.adminCookie)).status,
      401,
    );
    const passwordLogin = await f.signin(adminName);
    assert.equal(passwordLogin.status, 200, await passwordLogin.clone().text());
  } finally {
    f.close();
  }
});

for (const provenance of [
  "missing",
  "different-account",
  "different-email",
] as const) {
  test(`first email OTP removes unverified credentials when operator provenance is ${provenance}`, async () => {
    const f = await fixture({
      AUTH_MODE: "both",
      SMTP_HOST: "smtp.example.test",
      MAIL_FROM: "test@example.test",
    });
    try {
      const before = await bodyOf(
        await f.call("/api/state", undefined, f.adminCookie),
      );
      if (provenance === "missing") {
        f.db.native.prepare("DELETE FROM operator_password_accounts").run();
      } else if (provenance === "different-account") {
        f.db.native
          .prepare("UPDATE operator_password_accounts SET account_id=?")
          .run(randomUUID());
      } else {
        f.db.native
          .prepare("UPDATE operator_password_accounts SET email=?")
          .run("different-mailbox@example.test");
      }
      await bodyOf(
        await f.call("/api/auth/email-otp/send-verification-otp", {
          email: baseEnv.BOOTSTRAP_ADMIN_EMAIL,
          type: "sign-in",
        }),
      );
      assert.equal(f.captured.length, 1);
      const otp = f.captured[0].text.match(/kód je (\d{6})/)![1];
      const signed = await f.call("/api/auth/sign-in/email-otp", {
        email: baseEnv.BOOTSTRAP_ADMIN_EMAIL,
        otp,
      });
      await bodyOf(signed);
      const after = await bodyOf(
        await f.call("/api/state", undefined, cookieOf(signed)),
      );
      assert.equal(
        after.me.id,
        before.me.id,
        "mailbox proof preserves the same membership",
      );
      assert.equal(
        (await f.call("/api/state", undefined, f.adminCookie)).status,
        401,
      );
      assert.equal((await f.signin(adminName)).status, 401);
      assert.equal(
        f.db.native
          .prepare("SELECT id FROM account WHERE providerId='credential'")
          .get(),
        undefined,
        "the narrow trusted CLI exception must not retain an unmatched credential",
      );
    } finally {
      f.close();
    }
  });
}

for (const outcome of ["commit", "rollback"] as const) {
  test(`concurrent API and worker writes wait for a real signup transaction to ${outcome}`, async () => {
    const f = await fixture();
    const context = await f.auth.$context;
    const originalHash = context.password.hash;
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    let registration: Promise<Response> | undefined;
    let management: Promise<Response> | undefined;
    let worker: Promise<unknown> | undefined;
    try {
      const state = await bodyOf(
        await f.call("/api/state", undefined, f.adminCookie),
      );
      context.password.hash = async (value: string) => {
        entered.resolve();
        await release.promise;
        if (outcome === "rollback")
          throw new Error("Injected password hashing failure");
        return originalHash(value);
      };
      registration = f.register(`concurrent_${outcome}_person`);
      await entered.promise;
      let managementFinished = false;
      let workerFinished = false;
      management = f
        .adminAction("createInvite", {
          label: `While signup must ${outcome}`,
          maxUses: 1,
          expiresInDays: 1,
        })
        .then((response) => {
          managementFinished = true;
          return response;
        });
      const backgroundDb = queuedDatabase(f.db);
      const workerIds = [randomUUID(), randomUUID()];
      worker = backgroundDb
        .batch(
          workerIds.map((id) =>
            backgroundDb
              .prepare(
                "INSERT INTO audit(id,course_id,member_id,action,details,created_at) VALUES(?,?,?,?,?,?)",
              )
              .bind(
                id,
                f.settings.courseId,
                state.me.id,
                "worker.concurrent-test",
                "{}",
                new Date().toISOString(),
              ),
          ),
        )
        .then((result) => {
          workerFinished = true;
          return result;
        });
      await new Promise<void>((resolve) => setTimeout(resolve, 30));
      assert.equal(
        managementFinished,
        false,
        "another request must not enter the async signup transaction",
      );
      assert.equal(
        workerFinished,
        false,
        "background writes must not join an unrelated signup transaction",
      );
      release.resolve();
      const [registered, managed] = await Promise.all([
        registration,
        management,
        worker,
      ]);
      if (outcome === "commit") {
        assert.equal(registered.status, 201, await registered.clone().text());
        assert.equal((await bodyOf(registered)).membership, "pending");
      } else {
        assert.ok(registered.status >= 400);
        assert.equal(
          f.db.native
            .prepare("SELECT id FROM user WHERE username=?")
            .get(`concurrent_${outcome}_person`),
          undefined,
          "failed credential creation rolls back without leaving a user",
        );
      }
      assert.ok(managed.ok, await managed.clone().text());
      for (const id of workerIds) {
        assert.ok(
          await backgroundDb
            .prepare("SELECT id FROM audit WHERE id=?")
            .bind(id)
            .first(),
        );
      }
      assert.equal(
        (await f.signin(adminName)).status,
        200,
        "the database remains usable after either transaction outcome",
      );
    } finally {
      release.resolve();
      context.password.hash = originalHash;
      await Promise.allSettled([registration, management, worker]);
      f.close();
    }
  });
}

test("password reset abuse is rate limited without consuming unrelated valid reset tokens", async () => {
  const f = await fixture();
  try {
    const a = await f.approved("reset_limit_person");
    const created = await bodyOf(
      await f.adminAction("createReset", { memberId: a.memberId }),
    );
    const token = tokenOf(created.url, "reset");
    const fixedIp = { "x-real-ip": "198.51.100.98" };
    for (let i = 0; i < 10; i++)
      assert.ok(
        (
          await f.call(
            "/api/password/reset",
            { token: "z".repeat(43), newPassword },
            "",
            fixedIp,
          )
        ).status >= 400,
      );
    assert.equal(
      (
        await f.call(
          "/api/password/reset",
          { token: "z".repeat(43), newPassword },
          "",
          fixedIp,
        )
      ).status,
      429,
    );
    await bodyOf(await f.call("/api/password/reset", { token, newPassword }));
    assert.equal(
      (await f.signin("reset_limit_person", newPassword)).status,
      200,
    );
  } finally {
    f.close();
  }
});

test("changing a password requires the current secret and revokes other devices", async () => {
  const f = await fixture();
  try {
    const a = await f.approved("change_password_person");
    const secondCookie = cookieOf(await f.signin("change_password_person"));
    const wrong = await f.call(
      "/api/auth/change-password",
      {
        currentPassword: "wrong password",
        newPassword,
        revokeOtherSessions: true,
      },
      a.cookie,
    );
    assert.ok(wrong.status >= 400);
    assert.equal(
      (await f.call("/api/state", undefined, secondCookie)).status,
      200,
    );
    const changed = await f.call(
      "/api/auth/change-password",
      { currentPassword: password, newPassword, revokeOtherSessions: true },
      a.cookie,
    );
    await bodyOf(changed);
    assert.equal(
      (await f.call("/api/state", undefined, secondCookie)).status,
      401,
    );
    assert.ok((await f.signin("change_password_person")).status >= 400);
    assert.equal(
      (await f.signin("change_password_person", newPassword)).status,
      200,
    );
  } finally {
    f.close();
  }
});

test("failed reset rolls back password, token consumption and session revocation together", async () => {
  const f = await fixture();
  try {
    const a = await f.approved("atomic_reset_person");
    const created = await bodyOf(
      await f.adminAction("createReset", { memberId: a.memberId }),
    );
    const token = tokenOf(created.url, "reset");
    f.db.native.exec(
      "CREATE TRIGGER fail_reset_audit BEFORE INSERT ON audit WHEN NEW.action='password.reset' BEGIN SELECT RAISE(ABORT,'isolated test failure'); END",
    );
    const failed = await f.call("/api/password/reset", { token, newPassword });
    assert.ok(failed.status >= 400);
    assert.equal((await f.call("/api/state", undefined, a.cookie)).status, 200);
    assert.equal((await f.signin("atomic_reset_person")).status, 200);
    assert.ok(
      (await f.signin("atomic_reset_person", newPassword)).status >= 400,
    );
    f.db.native.exec("DROP TRIGGER fail_reset_audit");
    await bodyOf(await f.call("/api/password/reset", { token, newPassword }));
    assert.equal(
      (await f.signin("atomic_reset_person", newPassword)).status,
      200,
    );
    assert.equal((await f.call("/api/state", undefined, a.cookie)).status, 401);
  } finally {
    f.close();
  }
});
