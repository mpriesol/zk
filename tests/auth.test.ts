import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SQLiteDatabase, migrateApp } from "../server/sqlite.ts";
import {
  createAuth,
  migrateAuth,
  authSettingsFromEnv,
  createMailer,
  type AuthSettings,
  type Mail,
} from "../server/auth.ts";
import { createApiHandler, assertBuildConfiguration } from "../server/start.ts";
import { appPath, basePathFromUrl, stripAppPath } from "../lib/paths.ts";

const origin = "http://localhost:3000";
const settings: AuthSettings = {
  appUrl: origin + "/priprava",
  secret: "test-only-better-auth-secret-that-is-not-production-0123456789",
  courseId: "auth-test",
  bootstrapAdminEmail: "admin@example.test",
  production: false,
  mailMode: "file",
  mailDirectory: "/tmp/unused-auth-test-mail",
  mailFrom: "Cestou Zimy <test@example.test>",
  smtpPort: 587,
  smtpSecure: false,
};
const db = new SQLiteDatabase(),
  mail: Mail[] = [];
let auth: ReturnType<typeof createAuth>,
  api: ReturnType<typeof createApiHandler>,
  adminCookie = "";
let client = 0;
function req(
  path: string,
  body?: unknown,
  cookie = "",
  ip = "192.0.2." + ++client,
) {
  return new Request(origin + appPath(path, "/priprava"), {
    method: body === undefined ? "GET" : "POST",
    headers: {
      origin,
      "content-type": "application/json",
      "x-real-ip": ip,
      ...(cookie ? { cookie } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
function addMember(email: string, active = 1) {
  const id = email.split("@")[0];
  db.native
    .prepare(
      "INSERT INTO members(id,course_id,email,nickname,role,active,animations,joined_at) VALUES(?,?,?,?,?,?,1,?)",
    )
    .run(
      id,
      settings.courseId,
      email,
      id,
      "participant",
      active,
      new Date().toISOString(),
    );
  return id;
}
function latestCode(email: string) {
  const item = mail.filter((m) => m.to === email).at(-1);
  assert.ok(item, "mail was captured");
  const match = item.text.match(/kód je (\d{6})/);
  assert.ok(match);
  return match[1];
}
async function send(email: string, ip?: string) {
  return api(
    req(
      "/api/auth/email-otp/send-verification-otp",
      { email, type: "sign-in" },
      "",
      ip,
    ),
  );
}
async function verify(email: string, otp: string, ip?: string) {
  return api(req("/api/auth/sign-in/email-otp", { email, otp }, "", ip));
}
function cookieOf(response: Response) {
  return response.headers
    .getSetCookie()
    .map((v) => v.split(";")[0])
    .join("; ");
}
async function login(email: string) {
  const sent = await send(email);
  assert.equal(sent.status, 200, await sent.text());
  const response = await verify(email, latestCode(email));
  assert.equal(response.status, 200, await response.text());
  return cookieOf(response);
}

before(async () => {
  migrateApp(db);
  auth = createAuth(db, settings, async (message) => {
    mail.push(message);
  });
  await migrateAuth(auth);
  api = createApiHandler(db, auth, {
    siteUrl: settings.appUrl,
    courseId: settings.courseId,
    bootstrapAdminEmail: settings.bootstrapAdminEmail,
  });
  adminCookie = await login("admin@example.test");
  const state = await api(req("/api/state", undefined, adminCookie));
  assert.equal(state.status, 200, await state.text());
});
after(() => db.close());

test("real OTP login bootstraps only the configured verified admin and sets persistent HttpOnly cookie", async () => {
  const session = await api(
    req("/api/auth/get-session", undefined, adminCookie),
  );
  assert.equal(session.status, 200);
  const data = await session.json();
  assert.equal(data.user.email, "admin@example.test");
  assert.equal(data.user.emailVerified, true);
  const state = await (
    await api(req("/api/state", undefined, adminCookie))
  ).json();
  assert.equal(state.me.role, "admin");
  const email = "cookies@example.test";
  addMember(email);
  await send(email);
  const signed = await verify(email, latestCode(email));
  assert.equal(signed.status, 200);
  const cookies = signed.headers.getSetCookie().join(";");
  assert.match(cookies, /HttpOnly/i);
  assert.match(cookies, /SameSite=Lax/i);
  assert.match(cookies, /Path=\/priprava(?:;|$)/i);
  assert.match(cookies, /Max-Age=2592000/i);
});

test("invited participant gets persistent session and cannot acquire admin through OTP profile fields", async () => {
  const email = "participant@example.test";
  addMember(email);
  await send(email);
  const signed = await api(
    req("/api/auth/sign-in/email-otp", {
      email,
      otp: latestCode(email),
      role: "admin",
      name: "Test účastník",
    }),
  );
  assert.equal(signed.status, 200);
  const cookie = cookieOf(signed);
  const state = await api(req("/api/state", undefined, cookie));
  assert.equal(state.status, 200);
  assert.equal((await state.json()).me.role, "participant");
  const secondDevice = await api(req("/api/state", undefined, cookie));
  assert.equal(secondDevice.status, 200);
  const admin = await api(req("/api/admin", undefined, cookie));
  assert.equal(admin.status, 403);
});

test("unknown address receives no code, cannot sign in or gain access, and does not reveal membership", async () => {
  const email = "stranger@example.test",
    beforeCount = mail.length;
  const response = await send(email);
  assert.equal(response.status, 200);
  assert.equal(mail.length, beforeCount);
  assert.equal((await verify(email, "123456")).status, 401);
  assert.equal(
    db.native.prepare("SELECT id FROM user WHERE email=?").get(email),
    undefined,
  );
  assert.equal((await api(req("/api/state"))).status, 401);
});

test("removed membership blocks existing session and a code issued before removal", async () => {
  const email = "removed@example.test",
    id = addMember(email),
    cookie = await login(email);
  await send(email);
  const code = latestCode(email);
  db.native.prepare("UPDATE members SET active=0 WHERE id=?").run(id);
  assert.equal((await api(req("/api/state", undefined, cookie))).status, 403);
  assert.equal((await verify(email, code)).status, 401);
  const beforeCount = mail.length;
  assert.equal((await send(email)).status, 200);
  assert.equal(mail.length, beforeCount);
});

test("OTP is hashed in database, single-use, and forgery cannot create a session", async () => {
  const email = "once@example.test";
  addMember(email);
  await send(email);
  const code = latestCode(email);
  const verification = db.native
    .prepare("SELECT value FROM verification WHERE identifier LIKE ?")
    .all("%" + email + "%");
  assert.ok(verification.length);
  assert.ok(verification.every((row) => !String(row.value).includes(code)));
  assert.equal((await verify(email, code)).status, 200);
  assert.notEqual((await verify(email, code)).status, 200);
  assert.equal(
    (
      await api(
        req("/api/state", undefined, "better-auth.session_token=forged"),
      )
    ).status,
    401,
  );
});

test("expired OTP is rejected and a new code permits sign-in", async () => {
  const email = "expired@example.test";
  addMember(email);
  await send(email);
  const code = latestCode(email);
  db.native
    .prepare("UPDATE verification SET expiresAt=? WHERE identifier LIKE ?")
    .run(Date.now() - 60000, "%" + email + "%");
  assert.notEqual((await verify(email, code)).status, 200);
  await send(email);
  assert.equal((await verify(email, latestCode(email))).status, 200);
});

test("five wrong attempts invalidate a code, even from another network address", async () => {
  const email = "attempts@example.test";
  addMember(email);
  await send(email);
  const code = latestCode(email),
    wrong = code === "000000" ? "000001" : "000000";
  for (let i = 0; i < 5; i++)
    assert.notEqual((await verify(email, wrong)).status, 200);
  assert.notEqual((await verify(email, code)).status, 200);
});

test("rate limits apply to real HTTP auth routes and survive through the database", async () => {
  const email = "limited@example.test";
  addMember(email);
  const ip = "198.51.100.35";
  for (let i = 0; i < 3; i++) assert.equal((await send(email, ip)).status, 200);
  assert.equal((await send(email, ip)).status, 429);
  assert.ok(
    Number(
      (
        db.native.prepare("SELECT COUNT(*) count FROM rateLimit").get() as {
          count: number;
        }
      ).count,
    ) > 0,
  );
});

test("sign-out revokes old server session, returns cookies clearing credentials, and private data is no-store", async () => {
  const email = "logout@example.test";
  addMember(email);
  const cookie = await login(email);
  const before = await api(req("/api/state", undefined, cookie));
  assert.match(before.headers.get("cache-control") || "", /no-store/);
  const logout = await api(req("/api/auth/sign-out", {}, cookie));
  assert.equal(logout.status, 200);
  assert.match(logout.headers.getSetCookie().join(";"), /Max-Age=0/i);
  assert.equal((await api(req("/api/state", undefined, cookie))).status, 401);
});

test("cross-origin authentication and fake proxy identity headers do not grant access", async () => {
  const forged = new Request(origin + appPath("/api/state", "/priprava"), {
    headers: {
      "oai-authenticated-user-id": "admin",
      "oai-authenticated-user-email": settings.bootstrapAdminEmail!,
    },
  });
  assert.equal((await api(forged)).status, 401);
  const response = await api(
    new Request(
      origin +
        appPath("/api/auth/email-otp/send-verification-otp", "/priprava"),
      {
        method: "POST",
        headers: {
          origin: "https://attacker.example",
          "content-type": "application/json",
          "x-real-ip": "203.0.113.55",
        },
        body: JSON.stringify({
          email: settings.bootstrapAdminEmail,
          type: "sign-in",
        }),
      },
    ),
  );
  assert.equal(response.status, 403);
  assert.equal(
    (
      await api(
        req("/api/auth/sign-up/email", {
          email: "x@example.test",
          password: "example123",
        }),
      )
    ).status,
    404,
  );
});

test("development mail is a private filesystem delivery, never an API response", async () => {
  const directory = mkdtempSync(join(tmpdir(), "cz-mail-"));
  try {
    const delivery = createMailer({ ...settings, mailDirectory: directory });
    await delivery({
      to: "dev@example.test",
      subject: "test",
      text: "private code",
    });
    const file = join(directory, readdirSync(directory)[0]);
    assert.match(readFileSync(file, "utf8"), /private code/);
    assert.equal(statSync(file).mode & 0o777, 0o600);
    assert.equal(statSync(directory).mode & 0o777, 0o700);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("production fails closed without secret, HTTPS, SMTP or with development file delivery", () => {
  const common = {
    NODE_ENV: "production",
    AUTH_MODE: "email",
    APP_URL: "https://zimny.example/priprava",
    BETTER_AUTH_SECRET: settings.secret,
    SMTP_HOST: "smtp.example",
    MAIL_FROM: "x@example.test",
  };
  assert.throws(
    () => authSettingsFromEnv({ ...common, BETTER_AUTH_SECRET: "" }),
    /BETTER_AUTH_SECRET/,
  );
  assert.throws(
    () =>
      authSettingsFromEnv({
        ...common,
        APP_URL: "http://zimny.example/priprava",
      }),
    /HTTPS/,
  );
  assert.throws(
    () => authSettingsFromEnv({ ...common, SMTP_HOST: "" }),
    /SMTP/,
  );
  assert.throws(
    () => authSettingsFromEnv({ ...common, AUTH_MAIL_MODE: "file" }),
    /produkcii/,
  );
  assert.equal(authSettingsFromEnv(common).production, true);
});

test("application migrations are idempotent and do not replay data", () => {
  assert.deepEqual(migrateApp(db), []);
});

test("session and course records survive closing and reopening the SQLite file", async () => {
  const directory = mkdtempSync(join(tmpdir(), "cz-persistent-")),
    path = join(directory, "app.sqlite"),
    captured: Mail[] = [];
  let persistent = new SQLiteDatabase(path);
  try {
    migrateApp(persistent);
    const localSettings = { ...settings, courseId: "restart-test" };
    const firstAuth = createAuth(persistent, localSettings, async (m) => {
      captured.push(m);
    });
    await migrateAuth(firstAuth);
    const firstApi = createApiHandler(persistent, firstAuth, {
      siteUrl: localSettings.appUrl,
      courseId: "restart-test",
      bootstrapAdminEmail: settings.bootstrapAdminEmail,
    });
    assert.equal(
      (
        await firstApi(
          req("/api/auth/email-otp/send-verification-otp", {
            email: settings.bootstrapAdminEmail,
            type: "sign-in",
          }),
        )
      ).status,
      200,
    );
    const otp = captured.at(-1)!.text.match(/kód je (\d{6})/)![1],
      response = await firstApi(
        req("/api/auth/sign-in/email-otp", {
          email: settings.bootstrapAdminEmail,
          otp,
        }),
      ),
      cookie = cookieOf(response);
    assert.equal(response.status, 200);
    const initial = await (
      await firstApi(req("/api/state", undefined, cookie))
    ).json();
    assert.ok(initial.me.id);
    persistent.close();
    persistent = new SQLiteDatabase(path);
    assert.deepEqual(migrateApp(persistent), []);
    const secondAuth = createAuth(persistent, localSettings, async () => {});
    await migrateAuth(secondAuth);
    const secondApi = createApiHandler(persistent, secondAuth, {
      siteUrl: localSettings.appUrl,
      courseId: "restart-test",
      bootstrapAdminEmail: settings.bootstrapAdminEmail,
    });
    const restored = await secondApi(req("/api/state", undefined, cookie));
    assert.equal(restored.status, 200);
    assert.equal((await restored.json()).me.id, initial.me.id);
  } finally {
    persistent.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("canonical application prefix isolates API routes and validates deployment URL", async () => {
  assert.equal(
    (
      await api(
        new Request(origin + "/api/state", {
          headers: { cookie: adminCookie },
        }),
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await api(
        new Request(origin + "/zk/api/state", {
          headers: { cookie: adminCookie },
        }),
      )
    ).status,
    404,
  );
  assert.equal((await api(new Request(origin + "/healthz"))).status, 200);
  const config = {
    NODE_ENV: "production",
    BETTER_AUTH_SECRET: settings.secret,
    SMTP_HOST: "smtp.example",
    MAIL_FROM: "x@example.test",
  };
  assert.throws(
    () =>
      authSettingsFromEnv({ ...config, APP_URL: "https://zimnykurz.sk/other" }),
    /priprava/,
  );
  assert.equal(
    authSettingsFromEnv({ ...config, APP_URL: "https://hub.biketrek.sk/zk" })
      .appUrl,
    "https://hub.biketrek.sk/zk",
  );
  assert.equal(
    authSettingsFromEnv({
      ...config,
      APP_URL: "https://zimnykurz.sk/priprava/",
    }).appUrl,
    "https://zimnykurz.sk/priprava",
  );
});

test("one database works on Hub /zk first and public /priprava after switching APP_URL", async () => {
  const shared = new SQLiteDatabase();
  migrateApp(shared);
  const captured: Mail[] = [];
  let previousMember = "";
  try {
    for (const [host, prefix] of [
      ["https://hub.biketrek.sk", "/zk"],
      ["https://zimnykurz.sk", "/priprava"],
    ] as const) {
      const activeSettings: AuthSettings = {
        ...settings,
        appUrl: host + prefix,
        courseId: "switch-test",
        production: true,
        mailMode: "smtp",
        smtpHost: "smtp.example.test",
      };
      const activeAuth = createAuth(shared, activeSettings, async (message) => {
        captured.push(message);
      });
      await migrateAuth(activeAuth);
      const activeApi = createApiHandler(shared, activeAuth, {
        siteUrl: activeSettings.appUrl,
        courseId: "switch-test",
        bootstrapAdminEmail: settings.bootstrapAdminEmail,
      });
      const request = (path: string, body?: unknown, cookie = "") =>
        new Request(host + prefix + path, {
          method: body === undefined ? "GET" : "POST",
          headers: {
            origin: host,
            "content-type": "application/json",
            "x-real-ip": prefix === "/zk" ? "203.0.113.91" : "203.0.113.92",
            ...(cookie ? { cookie } : {}),
          },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
      assert.equal(
        (await activeApi(request("/api/state"))).status,
        401,
        "the new browser origin requires login",
      );
      assert.equal(
        (
          await activeApi(
            request("/api/auth/email-otp/send-verification-otp", {
              email: settings.bootstrapAdminEmail,
              type: "sign-in",
            }),
          )
        ).status,
        200,
      );
      const message = captured.at(-1)!;
      assert.ok(message.text.endsWith(activeSettings.appUrl));
      const otp = message.text.match(/kód je (\d{6})/)![1];
      const signed = await activeApi(
        request("/api/auth/sign-in/email-otp", {
          email: settings.bootstrapAdminEmail,
          otp,
        }),
      );
      assert.equal(signed.status, 200);
      assert.match(
        signed.headers.getSetCookie().join(";"),
        new RegExp("Path=" + prefix + "(?:;|$)"),
      );
      assert.match(signed.headers.getSetCookie().join(";"), /; Secure/i);
      const cookie = cookieOf(signed),
        stateResponse = await activeApi(
          request("/api/state", undefined, cookie),
        );
      assert.equal(stateResponse.status, 200);
      const state = await stateResponse.json();
      if (previousMember)
        assert.equal(
          state.me.id,
          previousMember,
          "switching keeps the same membership",
        );
      previousMember = state.me.id;
      const alternative = prefix === "/zk" ? "/priprava" : "/zk";
      assert.equal(
        (
          await activeApi(
            new Request(host + alternative + "/api/state", {
              headers: { cookie },
            }),
          )
        ).status,
        404,
      );
    }
    assert.equal(
      (
        shared.native.prepare("SELECT COUNT(*) n FROM user").get() as {
          n: number;
        }
      ).n,
      1,
    );
    assert.equal(
      (
        shared.native.prepare("SELECT COUNT(*) n FROM members").get() as {
          n: number;
        }
      ).n,
      1,
    );
  } finally {
    shared.close();
  }
});

test("base-path helpers validate supported deployments and normalize saved app links only", () => {
  assert.equal(basePathFromUrl("https://hub.biketrek.sk/zk/"), "/zk");
  assert.equal(basePathFromUrl("https://zimnykurz.sk/priprava"), "/priprava");
  for (const value of [
    "https://x.example/else",
    "https://x.example/zk?x=1",
    "https://x.example/priprava#x",
    "https://user:password@x.example/zk",
  ])
    assert.throws(() => basePathFromUrl(value));
  assert.equal(appPath("/?view=messages", "/zk"), "/zk/?view=messages");
  assert.equal(
    appPath("/zk/?view=messages", "/priprava"),
    "/priprava/?view=messages",
  );
  assert.equal(appPath("//attacker.example", "/zk"), "/zk/");
  assert.equal(stripAppPath("/zk/api/state", "/zk"), "/api/state");
  assert.equal(stripAppPath("/priprava/api/state", "/zk"), null);
});

test("production refuses missing or mismatched frontend build configuration", async () => {
  const directory = mkdtempSync(join(tmpdir(), "cz-build-config-"));
  try {
    await assert.rejects(
      assertBuildConfiguration("/zk", directory),
      /build-config/,
    );
    writeFileSync(
      join(directory, "build-config.json"),
      JSON.stringify({ appBasePath: "/priprava" }),
    );
    await assert.rejects(
      assertBuildConfiguration("/zk", directory),
      /nezhoduje/,
    );
    await assertBuildConfiguration("/priprava", directory);
    writeFileSync(
      join(directory, "build-config.json"),
      JSON.stringify({ appBasePath: "/zk" }),
    );
    await assertBuildConfiguration("/zk", directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
