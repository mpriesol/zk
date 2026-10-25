import { randomBytes, randomUUID, createHash } from "node:crypto";
import type { SQLiteDatabase } from "./sqlite.ts";
import { bootstrap } from "../lib/server.ts";
import {
  createAuth,
  type AuthSettings,
  getAuthSettings,
  passwordEnabled,
  emailOtpEnabled,
  displayUsername,
  normalizeUsername,
  validUsername,
  isInternalEmail,
} from "./auth.ts";

type Auth = ReturnType<typeof createAuth>;
export interface AccountSession {
  user: {
    id: string;
    email: string;
    name: string;
    emailVerified: boolean;
    username?: string | null;
    displayUsername?: string | null;
  };
}
type Row = Record<string, any>;
class AccountError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
const fail = (status: number, message: string): never => {
  throw new AccountError(status, message);
};
const json = (body: unknown, status = 200) =>
  Response.json(body, {
    status,
    headers: {
      "Cache-Control": "private, no-store",
      Vary: "Cookie",
      "X-Content-Type-Options": "nosniff",
    },
  });
const hashToken = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const tokenValue = (value: unknown) =>
  typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value)
    ? value
    : fail(400, "Odkaz je neplatný alebo už neplatí.");
const short = (value: unknown, max: number) =>
  typeof value === "string" && value.trim().length <= max
    ? value.trim()
    : fail(400, "Skontroluj vyplnené údaje.");
const passwordValue = (value: unknown) =>
  typeof value === "string" && value.length >= 10 && value.length <= 128
    ? value
    : fail(400, "Heslo musí mať 10 až 128 znakov.");
const usernameValue = (value: unknown) => {
  const original = typeof value === "string" ? displayUsername(value) : "";
  if (!validUsername(normalizeUsername(original)))
    fail(
      400,
      "Prezývka musí mať 3 až 32 znakov: písmená, čísla, medzery, bodku, pomlčku alebo podčiarkovník.",
    );
  return original;
};
function transaction<T>(db: SQLiteDatabase, work: () => T): T {
  db.native.exec("BEGIN IMMEDIATE");
  try {
    const result = work();
    db.native.exec("COMMIT");
    return result;
  } catch (error) {
    db.native.exec("ROLLBACK");
    throw error;
  }
}
function audit(
  db: SQLiteDatabase,
  cid: string,
  actor: string,
  action: string,
  details: object,
) {
  db.native
    .prepare(
      "INSERT INTO audit(id,course_id,member_id,action,details,created_at) VALUES(?,?,?,?,?,?)",
    )
    .run(
      randomUUID(),
      cid,
      actor,
      action,
      JSON.stringify(details),
      new Date().toISOString(),
    );
}
function limit(
  db: SQLiteDatabase,
  request: Request,
  action: string,
  max: number,
  windowMs: number,
) {
  const now = Date.now(),
    key = hashToken(
      action + ":" + (request.headers.get("x-real-ip") || "unknown"),
    );
  transaction(db, () => {
    db.native
      .prepare("DELETE FROM auth_rate_limits WHERE window_start<?")
      .run(now - 86_400_000);
    const current = db.native
      .prepare("SELECT window_start,count FROM auth_rate_limits WHERE id=?")
      .get(key);
    if (
      current &&
      Number(current.window_start) > now - windowMs &&
      Number(current.count) >= max
    )
      fail(429, "Priveľa pokusov. Skús to neskôr.");
    db.native
      .prepare(
        "INSERT INTO auth_rate_limits(id,window_start,count) VALUES(?,?,1) ON CONFLICT(id) DO UPDATE SET window_start=excluded.window_start,count=?",
      )
      .run(
        key,
        current && Number(current.window_start) > now - windowMs
          ? Number(current.window_start)
          : now,
        current && Number(current.window_start) > now - windowMs
          ? Number(current.count) + 1
          : 1,
      );
  });
}
function checkOrigin(request: Request, settings: AuthSettings) {
  const allowed = [
    new URL(settings.appUrl).origin,
    ...(settings.production ? [] : settings.trustedOrigins || []),
  ];
  if (!allowed.includes(request.headers.get("origin") || ""))
    fail(403, "Táto požiadavka nepochádza z aplikácie.");
  if (
    !request.headers
      .get("content-type")
      ?.toLowerCase()
      .startsWith("application/json")
  )
    fail(415, "Očakáva sa JSON.");
}
async function body(request: Request): Promise<Row> {
  const text = await request.text();
  if (text.length > 16_384) fail(413, "Požiadavka je príliš veľká.");
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    fail(400, "Neplatná požiadavka.");
  }
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail(400, "Neplatná požiadavka.");
  return value as Row;
}
export function credentialUser(db: SQLiteDatabase, userId: string): boolean {
  return !!db.native
    .prepare(
      "SELECT u.id FROM \"user\" u JOIN account a ON a.userId=u.id WHERE u.id=? AND u.username IS NOT NULL AND a.providerId='credential' AND a.password IS NOT NULL",
    )
    .get(userId);
}
function memberFor(
  db: SQLiteDatabase,
  settings: AuthSettings,
  session: AccountSession,
): Row | undefined {
  let member = db.native
    .prepare("SELECT * FROM members WHERE course_id=? AND user_id=?")
    .get(settings.courseId, session.user.id) as Row | undefined;
  if (
    !member &&
    session.user.emailVerified &&
    !isInternalEmail(session.user.email)
  ) {
    db.native
      .prepare(
        "UPDATE members SET user_id=? WHERE course_id=? AND email=? AND user_id IS NULL AND active=1",
      )
      .run(
        session.user.id,
        settings.courseId,
        session.user.email.toLowerCase(),
      );
    member = db.native
      .prepare("SELECT * FROM members WHERE course_id=? AND user_id=?")
      .get(settings.courseId, session.user.id) as Row | undefined;
  }
  return member;
}
function membership(
  db: SQLiteDatabase,
  settings: AuthSettings,
  session: AccountSession,
) {
  const member = memberFor(db, settings, session);
  if (member?.active) return "active";
  const request = db.native
    .prepare(
      "SELECT status FROM membership_requests WHERE course_id=? AND user_id=?",
    )
    .get(settings.courseId, session.user.id);
  return request?.status === "pending"
    ? "pending"
    : member
      ? "revoked"
      : "none";
}
function admin(
  db: SQLiteDatabase,
  settings: AuthSettings,
  session: AccountSession | null,
): Row {
  if (!session) fail(401, "Najprv sa prihlás.");
  const member = memberFor(db, settings, session!);
  if (!member?.active || member.role !== "admin")
    fail(403, "Táto operácia patrí organizátorovi.");
  return member!;
}
function consumeInvite(
  db: SQLiteDatabase,
  settings: AuthSettings,
  rawToken: string,
): void {
  const result = db.native
    .prepare(
      "UPDATE registration_invites SET uses=uses+1 WHERE course_id=? AND token_hash=? AND revoked=0 AND expires_at>? AND uses<max_uses",
    )
    .run(settings.courseId, hashToken(rawToken), new Date().toISOString());
  if (result.changes !== 1)
    fail(400, "Pozvánka je neplatná, vypršala alebo už bola využitá.");
}
function validInvite(
  db: SQLiteDatabase,
  settings: AuthSettings,
  rawToken: string,
) {
  return db.native
    .prepare(
      "SELECT id FROM registration_invites WHERE course_id=? AND token_hash=? AND revoked=0 AND expires_at>? AND uses<max_uses",
    )
    .get(settings.courseId, hashToken(rawToken), new Date().toISOString());
}
async function newPasswordUser(
  auth: Auth,
  input: { username: string; password: string; name?: string; email?: string },
) {
  const email = input.email || `${randomUUID()}@accounts.cestou-zimy.invalid`;
  const response = await auth.api.signUpEmail({
    body: {
      name: input.name || input.username,
      email,
      password: input.password,
      username: input.username,
      displayUsername: input.username,
      rememberMe: true,
    },
    asResponse: true,
  });
  const result = await response.json();
  if (!response.ok || !result.user?.id)
    fail(
      response.status >= 500 ? 503 : 400,
      response.status >= 500
        ? "Účet sa nepodarilo vytvoriť. Skús to znova."
        : "Túto prezývku nemožno použiť. Skús inú.",
    );
  return { response, user: result.user as AccountSession["user"] };
}
async function removeNewUser(auth: Auth, userId: string) {
  const context = await auth.$context;
  await context.internalAdapter.deleteUser(userId);
}
/** Called only by the local operator CLI; there is deliberately no public admin bootstrap route. */
export async function createInitialPasswordAdmin(
  db: SQLiteDatabase,
  auth: Auth,
  settings: AuthSettings,
  input: { username: string; password: string; name?: string },
): Promise<{ username: string; memberId: string }> {
  if (!passwordEnabled(settings))
    fail(409, "Najprv zapni AUTH_MODE=password alebo both.");
  if (
    db.native
      .prepare("SELECT id FROM courses WHERE id=?")
      .get(settings.courseId) ||
    db.native
      .prepare("SELECT id FROM members WHERE course_id=? AND role='admin'")
      .get(settings.courseId)
  )
    fail(
      409,
      "Kurz alebo organizátor už existuje. Tento príkaz nič neprepísal.",
    );
  const username = usernameValue(input.username),
    password = passwordValue(input.password),
    name = input.name ? short(input.name, 100) : undefined;
  const created = await newPasswordUser(auth, {
    username,
    password,
    name,
    email: settings.bootstrapAdminEmail,
  });
  try {
    await bootstrap(
      db,
      {
        userId: created.user.id,
        email: created.user.email,
        displayName: username,
      },
      { courseId: settings.courseId, bootstrapAdminEmail: created.user.email },
    );
    const member = db.native
      .prepare(
        "SELECT id FROM members WHERE course_id=? AND user_id=? AND role='admin' AND active=1",
      )
      .get(settings.courseId, created.user.id);
    if (!member) fail(409, "Organizátora už medzitým vytvoril iný proces.");
    db.native
      .prepare("UPDATE members SET nickname=? WHERE id=?")
      .run(username, member!.id);
    if (!isInternalEmail(created.user.email)) {
      const credential = db.native
        .prepare(
          "SELECT id FROM account WHERE userId=? AND providerId='credential' AND password IS NOT NULL",
        )
        .get(created.user.id);
      if (!credential) fail(409, "Organizátorský účet nemá heslo.");
      db.native
        .prepare(
          "INSERT INTO operator_password_accounts(user_id,account_id,email,created_at) VALUES(?,?,?,?)",
        )
        .run(
          created.user.id,
          credential!.id,
          created.user.email,
          new Date().toISOString(),
        );
    }
    // CLI never hands a session cookie to a browser; the operator signs in normally.
    db.native
      .prepare('DELETE FROM "session" WHERE userId=?')
      .run(created.user.id);
    return { username, memberId: String(member!.id) };
  } catch (error) {
    await removeNewUser(auth, created.user.id);
    throw error;
  }
}

export async function accountEndpoint(
  request: Request,
  path: string,
  session: AccountSession | null,
  db: SQLiteDatabase,
  auth: Auth,
): Promise<Response | null> {
  const settings = getAuthSettings(auth),
    cid = settings.courseId;
  const known = [
    "/api/auth-options",
    "/api/account",
    "/api/register",
    "/api/invites/accept",
    "/api/registration/admin",
    "/api/password/reset",
  ];
  if (!known.includes(path)) return null;
  try {
    if (path === "/api/auth-options" && request.method === "GET")
      return json({
        password: passwordEnabled(settings),
        emailOtp: emailOtpEnabled(settings),
        registrationOpen:
          passwordEnabled(settings) &&
          settings.registrationOpen !== false &&
          !!db.native.prepare("SELECT id FROM courses WHERE id=?").get(cid),
      });
    if (path === "/api/account" && request.method === "GET") {
      if (!session) fail(401, "Najprv sa prihlás.");
      return json({
        username:
          session!.user.displayUsername || session!.user.username || null,
        hasPassword: credentialUser(db, session!.user.id),
        membership: membership(db, settings, session!),
      });
    }
    if (path === "/api/registration/admin" && request.method === "GET") {
      admin(db, settings, session);
      const pending = db.native
        .prepare(
          "SELECT r.id,r.user_id userId,u.displayUsername username,m.nickname,r.created_at createdAt FROM membership_requests r JOIN \"user\" u ON u.id=r.user_id JOIN members m ON m.user_id=r.user_id AND m.course_id=r.course_id WHERE r.course_id=? AND r.status='pending' AND m.active=0 ORDER BY r.created_at",
        )
        .all(cid);
      const invites = db.native
        .prepare(
          "SELECT id,label,expires_at expiresAt,max_uses maxUses,uses,revoked,created_at createdAt FROM registration_invites WHERE course_id=? ORDER BY created_at DESC",
        )
        .all(cid)
        .map((r) => ({ ...r, revoked: !!r.revoked }));
      const passwordMembers = db.native
        .prepare(
          "SELECT m.id,u.displayUsername username,m.nickname,m.active FROM members m JOIN \"user\" u ON u.id=m.user_id JOIN account a ON a.userId=u.id AND a.providerId='credential' WHERE m.course_id=? AND u.username IS NOT NULL AND a.password IS NOT NULL ORDER BY m.nickname",
        )
        .all(cid)
        .map((r) => ({ ...r, active: !!r.active }));
      return json({
        pending,
        invites,
        passwordMembers,
        passwordEnabled: passwordEnabled(settings),
        emailOtpEnabled: emailOtpEnabled(settings),
      });
    }
    if (request.method !== "POST") fail(405, "Nepodporovaná operácia.");
    checkOrigin(request, settings);
    const data = await body(request);
    if (!passwordEnabled(settings))
      fail(404, "Prihlasovanie heslom nie je zapnuté.");
    if (path === "/api/register") {
      limit(db, request, "register", 5, 3_600_000);
      if (session) fail(409, "Pred vytvorením ďalšieho účtu sa odhlás.");
      if (
        settings.registrationOpen === false ||
        !db.native.prepare("SELECT id FROM courses WHERE id=?").get(cid)
      )
        fail(403, "Registrácia zatiaľ nie je otvorená.");
      const username = usernameValue(data.username),
        password = passwordValue(data.password),
        name =
          data.name === undefined || data.name === ""
            ? undefined
            : short(data.name, 100);
      const inviteToken = data.inviteToken
        ? tokenValue(data.inviteToken)
        : null;
      if (inviteToken && !validInvite(db, settings, inviteToken))
        fail(400, "Pozvánka je neplatná, vypršala alebo už bola využitá.");
      const created = await newPasswordUser(auth, {
        username,
        password,
        name,
      });
      try {
        transaction(db, () => {
          if (inviteToken) consumeInvite(db, settings, inviteToken);
          const memberId = randomUUID(),
            now = new Date().toISOString();
          db.native
            .prepare(
              "INSERT INTO members(id,course_id,user_id,email,nickname,role,active,animations,joined_at) VALUES(?,?,?,?,?,'participant',?,1,?)",
            )
            .run(
              memberId,
              cid,
              created.user.id,
              created.user.email,
              username,
              inviteToken ? 1 : 0,
              now,
            );
          db.native
            .prepare(
              "INSERT INTO membership_requests(id,course_id,user_id,status,created_at,reviewed_at,reviewed_by) VALUES(?,?,?,?,?,?,NULL)",
            )
            .run(
              randomUUID(),
              cid,
              created.user.id,
              inviteToken ? "approved" : "pending",
              now,
              inviteToken ? now : null,
            );
          audit(db, cid, memberId, "account.register", {
            memberId,
            membership: inviteToken ? "active" : "pending",
          });
        });
      } catch (error) {
        await removeNewUser(auth, created.user.id);
        throw error;
      }
      const result = json(
        { ok: true, membership: inviteToken ? "active" : "pending" },
        201,
      );
      for (const cookie of created.response.headers.getSetCookie())
        result.headers.append("Set-Cookie", cookie);
      return result;
    }
    if (path === "/api/invites/accept") {
      limit(db, request, "invite-accept", 10, 60_000);
      if (!session) fail(401, "Najprv sa prihlás.");
      const inviteToken = tokenValue(data.inviteToken);
      transaction(db, () => {
        const state = membership(db, settings, session!);
        if (state === "active") return;
        if (state !== "pending") fail(403, "O prístup požiadaj organizátora.");
        consumeInvite(db, settings, inviteToken);
        db.native
          .prepare(
            "UPDATE members SET active=1 WHERE course_id=? AND user_id=?",
          )
          .run(cid, session!.user.id);
        db.native
          .prepare(
            "UPDATE membership_requests SET status='approved',reviewed_at=? WHERE course_id=? AND user_id=? AND status='pending'",
          )
          .run(new Date().toISOString(), cid, session!.user.id);
        const member = memberFor(db, settings, session!)!;
        audit(db, cid, member.id, "account.acceptInvite", {
          memberId: member.id,
        });
      });
      return json({ ok: true, membership: "active" });
    }
    if (path === "/api/registration/admin") {
      const actor = admin(db, settings, session),
        now = new Date().toISOString();
      if (data.action === "createInvite") {
        const label =
            data.label === undefined
              ? "Pozvánka do kurzu"
              : short(data.label, 100),
          days = data.expiresInDays ?? 7,
          maxUses = data.maxUses ?? 30;
        if (
          !Number.isInteger(days) ||
          days < 1 ||
          days > 30 ||
          !Number.isInteger(maxUses) ||
          maxUses < 1 ||
          maxUses > 100
        )
          fail(400, "Skontroluj platnosť a počet použití pozvánky.");
        const token = randomBytes(32).toString("base64url"),
          id = randomUUID(),
          expiresAt = new Date(Date.now() + days * 86_400_000).toISOString();
        transaction(db, () => {
          db.native
            .prepare(
              "INSERT INTO registration_invites(id,course_id,token_hash,label,expires_at,max_uses,uses,revoked,created_at,created_by) VALUES(?,?,?,?,?,?,0,0,?,?)",
            )
            .run(
              id,
              cid,
              hashToken(token),
              label,
              expiresAt,
              maxUses,
              now,
              actor.id,
            );
          audit(db, cid, actor.id, "invite.create", { id, maxUses, expiresAt });
        });
        return json({
          id,
          url: settings.appUrl + "/#invite=" + token,
          expiresAt,
        });
      }
      if (data.action === "revokeInvite") {
        transaction(db, () => {
          const result = db.native
            .prepare(
              "UPDATE registration_invites SET revoked=1 WHERE id=? AND course_id=?",
            )
            .run(short(data.id, 100), cid);
          if (!result.changes) fail(404, "Pozvánka sa nenašla.");
          audit(db, cid, actor.id, "invite.revoke", { id: data.id });
        });
        return json({ ok: true });
      }
      if (data.action === "approve" || data.action === "reject") {
        transaction(db, () => {
          const target = db.native
            .prepare(
              "SELECT r.*,m.id member_id,m.role,m.active FROM membership_requests r JOIN members m ON m.user_id=r.user_id AND m.course_id=r.course_id WHERE r.id=? AND r.course_id=? AND r.status='pending'",
            )
            .get(short(data.id, 100), cid);
          if (!target || target.role !== "participant" || target.active)
            fail(409, "Táto žiadosť už nie je čakajúca.");
          db.native
            .prepare(
              "UPDATE membership_requests SET status=?,reviewed_at=?,reviewed_by=? WHERE id=?",
            )
            .run(
              data.action === "approve" ? "approved" : "rejected",
              now,
              actor.id,
              data.id,
            );
          db.native
            .prepare("UPDATE members SET active=? WHERE id=? AND course_id=?")
            .run(data.action === "approve" ? 1 : 0, target!.member_id, cid);
          audit(db, cid, actor.id, "account." + data.action, {
            memberId: target!.member_id,
          });
        });
        return json({ ok: true });
      }
      if (data.action === "createReset") {
        const target = db.native
          .prepare(
            "SELECT m.user_id FROM members m JOIN \"user\" u ON u.id=m.user_id JOIN account a ON a.userId=u.id AND a.providerId='credential' WHERE m.course_id=? AND m.id=? AND m.active=1 AND u.username IS NOT NULL AND a.password IS NOT NULL",
          )
          .get(cid, short(data.memberId, 100));
        if (!target) fail(404, "Aktívny účet s heslom sa nenašiel.");
        const token = randomBytes(32).toString("base64url"),
          expiresAt = new Date(Date.now() + 1_200_000).toISOString();
        transaction(db, () => {
          db.native
            .prepare(
              "UPDATE password_resets SET used_at=? WHERE course_id=? AND user_id=? AND used_at IS NULL",
            )
            .run(now, cid, target!.user_id);
          db.native
            .prepare(
              "INSERT INTO password_resets(id,course_id,user_id,token_hash,expires_at,used_at,created_at,created_by) VALUES(?,?,?,?,?,NULL,?,?)",
            )
            .run(
              randomUUID(),
              cid,
              target!.user_id,
              hashToken(token),
              expiresAt,
              now,
              actor.id,
            );
          audit(db, cid, actor.id, "password.issueReset", {
            memberId: data.memberId,
            expiresAt,
          });
        });
        return json({ url: settings.appUrl + "/#reset=" + token, expiresAt });
      }
      fail(400, "Neznáma operácia.");
    }
    if (path === "/api/password/reset") {
      limit(db, request, "password-reset", 10, 600_000);
      const token = tokenValue(data.token),
        password = passwordValue(data.newPassword),
        tokenHash = hashToken(token);
      const preview = db.native
        .prepare(
          "SELECT r.user_id FROM password_resets r JOIN members m ON m.user_id=r.user_id AND m.course_id=r.course_id WHERE r.course_id=? AND r.token_hash=? AND r.used_at IS NULL AND r.expires_at>? AND m.active=1",
        )
        .get(cid, tokenHash, new Date().toISOString());
      if (!preview || !credentialUser(db, String(preview.user_id)))
        fail(400, "Odkaz na zmenu hesla je neplatný alebo už neplatí.");
      const hashed = await (await auth.$context).password.hash(password);
      transaction(db, () => {
        const now = new Date().toISOString();
        const consumed = db.native
          .prepare(
            "UPDATE password_resets SET used_at=? WHERE course_id=? AND token_hash=? AND used_at IS NULL AND expires_at>? AND EXISTS(SELECT 1 FROM members WHERE course_id=? AND user_id=password_resets.user_id AND active=1) RETURNING user_id",
          )
          .get(now, cid, tokenHash, now, cid);
        if (!consumed)
          fail(400, "Odkaz na zmenu hesla je neplatný alebo už neplatí.");
        const updated = db.native
          .prepare(
            "UPDATE account SET password=?,updatedAt=? WHERE userId=? AND providerId='credential'",
          )
          .run(hashed, Date.now(), consumed!.user_id);
        if (updated.changes !== 1) fail(409, "Heslo sa nepodarilo zmeniť.");
        db.native
          .prepare('DELETE FROM "session" WHERE userId=?')
          .run(consumed!.user_id);
        const target = db.native
          .prepare("SELECT id FROM members WHERE course_id=? AND user_id=?")
          .get(cid, consumed!.user_id)!;
        audit(db, cid, String(target.id), "password.reset", {
          memberId: target.id,
        });
      });
      return json({ ok: true });
    }
    return json({ error: "Nepodporovaná operácia." }, 405);
  } catch (error) {
    if (error instanceof AccountError)
      return json({ error: error.message }, error.status);
    // Library errors may contain request data; return no provider internals or passwords.
    return json(
      {
        error:
          "Požiadavku sa nepodarilo dokončiť. Skontroluj údaje a skús to znova.",
      },
      400,
    );
  }
}
