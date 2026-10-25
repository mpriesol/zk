import { betterAuth } from "better-auth";
import { emailOTP } from "better-auth/plugins";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { getMigrations } from "better-auth/db/migration";
import nodemailer from "nodemailer";
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
  chmodSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import type { SQLiteDatabase } from "./sqlite.ts";
import { APP_BASE_PATH, appPath, basePathFromUrl } from "../lib/paths.ts";

export interface Mail {
  to: string;
  subject: string;
  text: string;
  messageId?: string;
}
export interface AuthSettings {
  appUrl: string;
  secret: string;
  courseId: string;
  bootstrapAdminEmail?: string;
  production: boolean;
  mailMode: "smtp" | "file";
  mailDirectory: string;
  mailFrom: string;
  smtpHost?: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUser?: string;
  smtpPassword?: string;
  trustedOrigins?: string[];
}
export function authSettingsFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): AuthSettings {
  const production = env.NODE_ENV === "production";
  const appUrl =
    env.APP_URL || `http://localhost:${env.PORT || 3000}${APP_BASE_PATH}`;
  const basePath = basePathFromUrl(appUrl),
    url = new URL(appUrl);
  if (production && url.protocol !== "https:")
    throw new Error("Produkčná APP_URL vyžaduje HTTPS za Caddy.");
  let secret = env.BETTER_AUTH_SECRET;
  if (!secret && !production) {
    const folder = resolve(".data");
    mkdirSync(folder, { recursive: true, mode: 0o700 });
    const path = join(folder, "auth-secret");
    if (!existsSync(path))
      writeFileSync(path, randomBytes(48).toString("base64url"), {
        mode: 0o600,
        flag: "wx",
      });
    secret = readFileSync(path, "utf8").trim();
    chmodSync(path, 0o600);
  }
  if (!secret || secret.length < 32)
    throw new Error(
      "Nastav BETTER_AUTH_SECRET na náhodné tajomstvo s aspoň 32 znakmi.",
    );
  const mailMode = env.AUTH_MAIL_MODE || "smtp";
  if (mailMode !== "smtp" && mailMode !== "file")
    throw new Error("AUTH_MAIL_MODE musí byť smtp alebo file.");
  if (production && mailMode === "file")
    throw new Error("Vývojové ukladanie e-mailov je v produkcii zakázané.");
  if (production && (!env.SMTP_HOST || !env.MAIL_FROM))
    throw new Error(
      "Produkčný e-mailový login vyžaduje SMTP_HOST a MAIL_FROM.",
    );
  return {
    appUrl: url.origin + basePath,
    secret,
    production,
    courseId: env.COURSE_ID || "cestou-zimy",
    bootstrapAdminEmail: env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase(),
    mailMode,
    mailDirectory: resolve(env.MAIL_DIRECTORY || ".data/mail"),
    mailFrom: env.MAIL_FROM || "Cestou Zimy <noreply@example.test>",
    smtpHost: env.SMTP_HOST,
    smtpPort: Number(env.SMTP_PORT || 587),
    smtpSecure: env.SMTP_SECURE === "true",
    smtpUser: env.SMTP_USER,
    smtpPassword: env.SMTP_PASSWORD,
    trustedOrigins: env.AUTH_TRUSTED_ORIGINS?.split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  };
}
export function createMailer(
  settings: AuthSettings,
): (mail: Mail) => Promise<void> {
  if (settings.mailMode === "file") {
    if (settings.production)
      throw new Error("Vývojový mailbox nie je povolený v produkcii.");
    mkdirSync(settings.mailDirectory, { recursive: true, mode: 0o700 });
    chmodSync(settings.mailDirectory, 0o700);
    return async (mail) => {
      writeFileSync(
        join(settings.mailDirectory, `${Date.now()}-${randomUUID()}.json`),
        JSON.stringify(
          { ...mail, createdAt: new Date().toISOString() },
          null,
          2,
        ),
        { mode: 0o600, flag: "wx" },
      );
    };
  }
  const smtp = settings.smtpHost
    ? nodemailer.createTransport({
        host: settings.smtpHost,
        port: settings.smtpPort,
        secure: settings.smtpSecure,
        requireTLS: !settings.smtpSecure,
        auth: settings.smtpUser
          ? { user: settings.smtpUser, pass: settings.smtpPassword }
          : undefined,
        connectionTimeout: 10000,
        greetingTimeout: 10000,
        socketTimeout: 15000,
        tls: { minVersion: "TLSv1.2" },
      })
    : null;
  return async (mail) => {
    if (!smtp)
      throw new Error(
        "Prihlasovacie e-maily zatiaľ nemajú nastavený SMTP server.",
      );
    const result = await smtp.sendMail({ ...mail, from: settings.mailFrom });
    if (!result.accepted?.length)
      throw new Error("SMTP server neprijal e-mail.");
  };
}

/** Standard Better Auth email OTP; all identity comes from its signed session cookie. */
export function createAuth(
  db: SQLiteDatabase,
  settings: AuthSettings,
  deliverMail = createMailer(settings),
) {
  const basePath = basePathFromUrl(settings.appUrl);
  const eligible = (email: string) => {
    const member = db.native
      .prepare(
        "SELECT id FROM members WHERE course_id=? AND email=? AND active=1",
      )
      .get(settings.courseId, email);
    if (member) return true;
    return (
      email === settings.bootstrapAdminEmail &&
      !db.native
        .prepare("SELECT id FROM courses WHERE id=?")
        .get(settings.courseId)
    );
  };
  const auth = betterAuth({
    appName: "Cestou Zimy",
    baseURL: new URL(settings.appUrl).origin,
    basePath: appPath("/api/auth", basePath),
    secret: settings.secret,
    database: db.native,
    trustedOrigins: [
      new URL(settings.appUrl).origin,
      ...(settings.trustedOrigins || []),
    ],
    emailAndPassword: { enabled: false },
    session: {
      expiresIn: 60 * 60 * 24 * 30,
      updateAge: 60 * 60 * 24,
      cookieCache: { enabled: false },
    },
    advanced: {
      useSecureCookies: settings.production,
      defaultCookieAttributes: {
        httpOnly: true,
        sameSite: "lax",
        path: basePath,
      },
      ipAddress: { ipAddressHeaders: ["x-real-ip"] },
    },
    rateLimit: {
      enabled: true,
      storage: "database",
      window: 60,
      max: 100,
      customRules: {
        "/email-otp/send-verification-otp": { window: 60, max: 3 },
        "/sign-in/email-otp": { window: 60, max: 8 },
      },
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (
          ctx.path === "/email-otp/send-verification-otp" &&
          ctx.body?.type !== "sign-in"
        )
          throw new APIError("BAD_REQUEST", {
            message: "Aplikácia používa iba prihlasovací kód.",
          });
        if (ctx.path === "/sign-in/email-otp") {
          const email = String(ctx.body?.email || "")
            .trim()
            .toLowerCase();
          if (!eligible(email))
            throw new APIError("UNAUTHORIZED", {
              message:
                "Prihlásenie sa nepodarilo. Skontroluj kód a pozvánku do kurzu.",
            });
        }
      }),
    },
    plugins: [
      emailOTP({
        otpLength: 6,
        expiresIn: 600,
        allowedAttempts: 5,
        storeOTP: "hashed",
        disableSignUp: false,
        async sendVerificationOTP({ email, otp, type }) {
          if (type !== "sign-in" || !eligible(email.toLowerCase())) return; // Same successful response avoids exposing membership.
          try {
            await deliverMail({
              to: email,
              subject: "Prihlasovací kód · Cestou Zimy",
              text: `Tvoj jednorazový prihlasovací kód je ${otp}.\n\nPlatí 10 minút. Pri opätovnom odoslaní použi iba najnovší kód.\n\nAk si o kód nežiadal, správu ignoruj. Nikomu ho neposielaj.\n${settings.appUrl}`,
            });
          } catch {
            throw new APIError("SERVICE_UNAVAILABLE", {
              message:
                "E-mail sa nepodarilo odoslať. Skús to neskôr alebo sa ozvi organizátorovi.",
            });
          }
        },
      }),
    ],
  });
  return auth;
}
export async function migrateAuth(auth: ReturnType<typeof createAuth>) {
  const { runMigrations } = await getMigrations(auth.options);
  await runMigrations();
}
