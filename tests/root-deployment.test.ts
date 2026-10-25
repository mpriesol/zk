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
import { appPath, basePathFromUrl } from "../lib/paths.ts";
import { notificationPath, validNotificationPath } from "../lib/push.ts";

const hubUrl = "https://hub.biketrek.sk/zk";
const rootUrl = "https://priprava.zimnykurz.sk";
const password = "Isolated root deployment password 42!";
const replacementPassword = "Changed root deployment password 43!";
const adminUsername = "root_test_admin";
const adminEmail = "operator@example.test";
const courseId = "root-deployment-test";
let nextIp = 1;

function cookieOf(response: Response) {
  return response.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
}
async function result(response: Response) {
  assert.ok(
    response.ok,
    `HTTP ${response.status}: ${await response.clone().text()}`,
  );
  return response.json();
}
function tokenOf(link: string, kind: "invite" | "reset", expectedUrl: string) {
  const parsed = new URL(link);
  assert.equal(parsed.origin + parsed.pathname, expectedUrl + "/");
  assert.equal(parsed.search, "");
  const token = new URLSearchParams(parsed.hash.slice(1)).get(kind);
  assert.match(token || "", /^[A-Za-z0-9_-]{43}$/);
  return token!;
}
function rootCookie(response: Response) {
  const cookies = response.headers.getSetCookie();
  assert.ok(cookies.length);
  for (const cookie of cookies) {
    assert.match(cookie, /; Path=\/(?:;|$)/i);
    assert.match(cookie, /; HttpOnly(?:;|$)/i);
    assert.match(cookie, /; Secure(?:;|$)/i);
    assert.doesNotMatch(
      cookie,
      /; Domain=/i,
      "the browser must retain host-only cookies",
    );
    assert.doesNotMatch(cookie, /; Path=\/(?:zk|priprava)(?:;|$)/i);
  }
  return cookieOf(response);
}
async function deployment(
  db: SQLiteDatabase,
  appUrl: string,
  mode: "password" | "both" = "password",
) {
  migrateApp(db);
  const mail: Mail[] = [];
  const settings = authSettingsFromEnv({
    NODE_ENV: "production",
    APP_URL: appUrl,
    AUTH_MODE: mode,
    COURSE_ID: courseId,
    BOOTSTRAP_ADMIN_EMAIL: adminEmail,
    BETTER_AUTH_SECRET:
      "isolated-root-deployment-test-secret-never-used-in-production-12345",
    ...(mode === "both"
      ? { SMTP_HOST: "smtp.example.test", MAIL_FROM: "test@example.test" }
      : {}),
  });
  const auth = createAuth(db, settings, async (message) => {
    mail.push(message);
  });
  await migrateAuth(auth);
  const api = createApiHandler(db, auth, {
    siteUrl: settings.appUrl,
    courseId,
    bootstrapAdminEmail: adminEmail,
    emailEnabled: mode === "both",
  });
  const origin = new URL(settings.appUrl).origin;
  const call = (path: string, body?: unknown, cookie = "") =>
    api(
      new Request(settings.appUrl + path, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          origin,
          "content-type": "application/json",
          "x-real-ip": `198.51.100.${(nextIp++ % 250) + 1}`,
          ...(cookie ? { cookie } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    );
  const signIn = (username = adminUsername, secret = password) =>
    call("/api/auth/sign-in/username", { username, password: secret });
  const action = (
    cookie: string,
    action: string,
    fields: Record<string, unknown>,
  ) => call("/api/action", { action, ...fields }, cookie);
  const manage = (
    cookie: string,
    action: string,
    fields: Record<string, unknown> = {},
  ) => call("/api/registration/admin", { action, ...fields }, cookie);
  return { settings, auth, api, call, signIn, action, manage, mail };
}

test("root subdomain serves real registration, scoped cookies and working invite/reset links without SMTP", async () => {
  const db = new SQLiteDatabase();
  try {
    const site = await deployment(db, rootUrl + "/");
    assert.equal(site.settings.appUrl, rootUrl);
    assert.equal(basePathFromUrl(site.settings.appUrl), "");
    await createInitialPasswordAdmin(db, site.auth, site.settings, {
      username: adminUsername,
      password,
    });
    assert.deepEqual(await result(await site.call("/api/auth-options")), {
      password: true,
      emailOtp: false,
      registrationOpen: true,
    });
    const adminLogin = await site.signIn();
    await result(adminLogin);
    const adminCookie = rootCookie(adminLogin);
    const invitation = await result(
      await site.manage(adminCookie, "createInvite", {
        maxUses: 1,
        expiresInDays: 1,
      }),
    );
    const inviteToken = tokenOf(invitation.url, "invite", rootUrl);
    const registration = await site.call("/api/register", {
      username: "root_participant",
      password,
      inviteToken,
    });
    assert.equal(registration.status, 201);
    const participantCookie = rootCookie(registration);
    assert.equal((await result(registration)).membership, "active");
    const participant = await result(
      await site.call("/api/state", undefined, participantCookie),
    );
    assert.equal(participant.me.nickname, "root_participant");
    for (const oldPrefix of ["/zk", "/priprava"]) {
      assert.equal(
        (
          await site.call(
            oldPrefix + "/api/state",
            undefined,
            participantCookie,
          )
        ).status,
        404,
        "legacy prefixes are not inbound API aliases",
      );
    }
    const reset = await result(
      await site.manage(adminCookie, "createReset", {
        memberId: participant.me.id,
      }),
    );
    const resetToken = tokenOf(reset.url, "reset", rootUrl);
    await result(
      await site.call("/api/password/reset", {
        token: resetToken,
        newPassword: replacementPassword,
      }),
    );
    assert.equal(
      (await site.call("/api/state", undefined, participantCookie)).status,
      401,
    );
    const changedLogin = await site.signIn(
      "root_participant",
      replacementPassword,
    );
    await result(changedLogin);
    const changedState = await result(
      await site.call("/api/state", undefined, rootCookie(changedLogin)),
    );
    assert.equal(changedState.me.id, participant.me.id);
    assert.equal(site.mail.length, 0);
  } finally {
    db.close();
  }
});

test("switching a persisted Hub database to the root subdomain keeps accounts, activities, links and optional OTP", async () => {
  const directory = mkdtempSync(join(tmpdir(), "cz-root-switch-"));
  const file = join(directory, "app.sqlite");
  let db = new SQLiteDatabase(file);
  try {
    const hub = await deployment(db, hubUrl);
    await createInitialPasswordAdmin(db, hub.auth, hub.settings, {
      username: adminUsername,
      password,
    });
    const hubAdminLogin = await hub.signIn();
    await result(hubAdminLogin);
    assert.match(
      hubAdminLogin.headers.getSetCookie().join("\n"),
      /Path=\/zk(?:;|$)/,
    );
    const hubAdminCookie = cookieOf(hubAdminLogin);
    const before = await result(
      await hub.call("/api/state", undefined, hubAdminCookie),
    );
    const invitation = await result(
      await hub.manage(hubAdminCookie, "createInvite", {
        maxUses: 2,
        expiresInDays: 1,
      }),
    );
    const inviteToken = tokenOf(invitation.url, "invite", hubUrl);
    const registered = await hub.call("/api/register", {
      username: "migrated_participant",
      password,
      inviteToken,
    });
    await result(registered);
    const hubParticipantCookie = cookieOf(registered);
    const participant = await result(
      await hub.call("/api/state", undefined, hubParticipantCookie),
    );
    const saved = await result(
      await hub.action(hubParticipantCookie, "saveActivity", {
        idempotencyKey: randomUUID(),
        typeId: participant.types.find((item: any) => item.group === "foot").id,
        date: participant.course.startDate,
        minutes: 40,
        distance: null,
        note: "Aktivita pred presunom domény",
      }),
    );
    const oldReset = await result(
      await hub.manage(hubAdminCookie, "createReset", {
        memberId: participant.me.id,
      }),
    );
    const oldResetToken = tokenOf(oldReset.url, "reset", hubUrl);
    for (const [index, prefix] of ["/zk", "/priprava"].entries()) {
      const message = await result(
        await hub.action(hubAdminCookie, "saveMessage", {
          title: `Historický odkaz ${index}`,
          body: "Odkaz uložený pred zmenou verejnej domény.",
          link: prefix + "/?view=feed",
          audience: "all",
          important: false,
          pinned: false,
          push: false,
        }),
      );
      await result(
        await hub.action(hubAdminCookie, "sendMessage", { id: message.id }),
      );
    }
    db.close();
    db = new SQLiteDatabase(file);
    const site = await deployment(db, rootUrl, "both");
    assert.deepEqual(await result(await site.call("/api/auth-options")), {
      password: true,
      emailOtp: true,
      registrationOpen: true,
    });
    assert.equal(
      (await site.call("/api/state")).status,
      401,
      "a new browser origin still requires login",
    );
    const rootAdminLogin = await site.signIn();
    await result(rootAdminLogin);
    const rootAdminCookie = rootCookie(rootAdminLogin);
    const migratedAdmin = await result(
      await site.call("/api/state", undefined, rootAdminCookie),
    );
    assert.equal(migratedAdmin.me.id, before.me.id);
    const rootParticipantLogin = await site.signIn("migrated_participant");
    await result(rootParticipantLogin);
    const rootParticipantCookie = rootCookie(rootParticipantLogin);
    const migrated = await result(
      await site.call("/api/state", undefined, rootParticipantCookie),
    );
    assert.equal(migrated.me.id, participant.me.id);
    assert.ok(
      migrated.activities.some(
        (item: any) =>
          item.id === saved.id && item.note === "Aktivita pred presunom domény",
      ),
    );
    for (const message of migrated.messages.filter((item: any) =>
      item.title.startsWith("Historický odkaz"),
    )) {
      assert.equal(
        appPath(message.link, basePathFromUrl(site.settings.appUrl)),
        "/?view=feed",
      );
    }
    assert.equal(
      migrated.messages.filter((item: any) =>
        item.title.startsWith("Historický odkaz"),
      ).length,
      2,
    );
    const oldInviteAccepted = await site.call("/api/register", {
      username: "invited_after_move",
      password,
      inviteToken,
    });
    assert.equal(
      (await result(oldInviteAccepted)).membership,
      "active",
      "existing invitation tokens survive the origin change",
    );
    await result(
      await site.call("/api/password/reset", {
        token: oldResetToken,
        newPassword: replacementPassword,
      }),
    );
    assert.equal(
      (await site.call("/api/state", undefined, rootParticipantCookie)).status,
      401,
    );
    const recovered = await site.signIn(
      "migrated_participant",
      replacementPassword,
    );
    await result(recovered);
    assert.equal(
      (
        await result(
          await site.call("/api/state", undefined, rootCookie(recovered)),
        )
      ).me.id,
      participant.me.id,
    );
    await result(
      await site.call("/api/auth/email-otp/send-verification-otp", {
        email: adminEmail,
        type: "sign-in",
      }),
    );
    assert.equal(site.mail.length, 1);
    assert.ok(site.mail[0].text.includes(rootUrl));
    assert.equal(site.mail[0].text.includes(hubUrl), false);
    const otp = site.mail[0].text.match(/kód je (\d{6})/)![1];
    const emailLogin = await site.call("/api/auth/sign-in/email-otp", {
      email: adminEmail,
      otp,
    });
    await result(emailLogin);
    const emailState = await result(
      await site.call("/api/state", undefined, rootCookie(emailLogin)),
    );
    assert.equal(emailState.me.id, before.me.id);
    assert.equal(
      (await site.signIn()).status,
      200,
      "the trusted operator can continue using the original password",
    );
    const currentInvite = await result(
      await site.manage(cookieOf(await site.signIn()), "createInvite", {
        maxUses: 1,
        expiresInDays: 1,
      }),
    );
    tokenOf(currentInvite.url, "invite", rootUrl);
    assert.equal(
      notificationPath("saved message", rootUrl),
      "/?view=messages&message=saved%20message",
    );
    assert.equal(
      validNotificationPath(notificationPath("saved message", rootUrl), ""),
      "/?view=messages&message=saved%20message",
    );
    assert.equal(
      validNotificationPath("/api/auth/sign-out", ""),
      "/?view=messages",
    );
  } finally {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
