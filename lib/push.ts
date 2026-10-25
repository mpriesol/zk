import { buildPushPayload } from "@block65/webcrypto-web-push";
import { APP_BASE_PATH } from "./paths.ts";

export interface StoredPushSubscription {
  endpoint: string;
  expirationTime: number | null;
  keys: { p256dh: string; auth: string };
}
export interface PushConfiguration {
  publicKey: string;
  privateKey: string;
  subject: string;
  applicationUrl?: string;
}
export interface PushPayload {
  messageId: string;
  title?: string;
  body?: string;
}
export type SendResult =
  | { status: "accepted"; httpStatus: number }
  | { status: "expired"; httpStatus: number }
  | {
      status: "retry";
      httpStatus: number | null;
      retryAfterSeconds: number;
      reason: string;
    }
  | { status: "failed"; httpStatus: number | null; reason: string };

const providerHosts = [
  "fcm.googleapis.com",
  "updates.push.services.mozilla.com",
  "push.services.mozilla.com",
  "web.push.apple.com",
  "notify.windows.com",
];
function base64Bytes(value: unknown): Uint8Array | null {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+={0,2}$/.test(value))
    return null;
  try {
    const raw = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
    return Uint8Array.from(raw, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}
/** Reject arbitrary outbound hosts, embedded credentials, nonstandard ports and malformed keys. */
export function validateSubscription(input: unknown): StoredPushSubscription {
  if (!input || typeof input !== "object")
    throw new Error("Neplatný odber upozornení.");
  const value = input as Partial<StoredPushSubscription>;
  if (typeof value.endpoint !== "string" || value.endpoint.length > 4096)
    throw new Error("Neplatná adresa odberu.");
  let url: URL;
  try {
    url = new URL(value.endpoint);
  } catch {
    throw new Error("Neplatná adresa odberu.");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.hash ||
    (url.port && url.port !== "443") ||
    !providerHosts.some(
      (host) => url.hostname === host || url.hostname.endsWith(`.${host}`),
    )
  ) {
    throw new Error("Nepodporovaný poskytovateľ upozornení.");
  }
  const publicKey = base64Bytes(value.keys?.p256dh);
  const authKey = base64Bytes(value.keys?.auth);
  if (
    !publicKey ||
    publicKey.length !== 65 ||
    publicKey[0] !== 4 ||
    !authKey ||
    authKey.length !== 16
  )
    throw new Error("Neplatné kľúče odberu.");
  if (
    value.expirationTime !== undefined &&
    value.expirationTime !== null &&
    (!Number.isFinite(value.expirationTime) || value.expirationTime <= 0)
  ) {
    throw new Error("Neplatná platnosť odberu.");
  }
  return {
    endpoint: url.toString(),
    expirationTime: value.expirationTime ?? null,
    keys: { p256dh: value.keys!.p256dh, auth: value.keys!.auth },
  };
}
/** Origin + application scope, without trailing slash. Server-derived subscription metadata. */
export function normalizeApplicationUrl(value: unknown): string {
  if (typeof value !== "string") return "";
  try {
    const url = new URL(value);
    if (
      (url.protocol !== "https:" &&
        !(
          url.protocol === "http:" &&
          ["localhost", "127.0.0.1", "[::1]", "terminal.local"].includes(
            url.hostname,
          )
        )) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      return "";
    return url.origin + url.pathname.replace(/\/+$/, "");
  } catch {
    return "";
  }
}
export function notificationPath(
  messageId: string,
  applicationUrl?: string,
): string {
  const normalized = normalizeApplicationUrl(applicationUrl);
  const selected = normalized
    ? new URL(normalized).pathname.replace(/\/+$/, "")
    : APP_BASE_PATH;
  const base =
    selected === "" || selected === "/zk" || selected === "/priprava"
      ? selected
      : APP_BASE_PATH;
  return `${base}/?view=messages&message=${encodeURIComponent(messageId)}`;
}
export function validNotificationPath(
  path: unknown,
  basePath = APP_BASE_PATH,
): string {
  const fallback = `${basePath}/?view=messages`;
  if (
    typeof path !== "string" ||
    !path.startsWith("/") ||
    path.startsWith("//") ||
    path.includes("\\")
  )
    return fallback;
  try {
    const parsed = new URL(path, "https://cestou-zimy.invalid");
    const inside =
      parsed.pathname === basePath ||
      parsed.pathname.startsWith(`${basePath}/`);
    const relative = parsed.pathname.slice(basePath.length);
    if (
      parsed.origin !== "https://cestou-zimy.invalid" ||
      !inside ||
      /%(?:2f|5c)/i.test(parsed.pathname) ||
      /^\/(?:api|signin-with-chatgpt|signout-with-chatgpt|callback)(?:\/|$)/.test(
        relative,
      )
    )
      return fallback;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return fallback;
  }
}
export function classifyPushResponse(response: Response): SendResult {
  if (response.status >= 200 && response.status < 300)
    return { status: "accepted", httpStatus: response.status };
  if (response.status === 404 || response.status === 410)
    return { status: "expired", httpStatus: response.status };
  if (
    response.status === 408 ||
    response.status === 429 ||
    response.status >= 500
  ) {
    const retry = response.headers.get("retry-after");
    const seconds =
      retry && /^\d+$/.test(retry)
        ? Number(retry)
        : retry
          ? Math.ceil((Date.parse(retry) - Date.now()) / 1000)
          : 60;
    return {
      status: "retry",
      httpStatus: response.status,
      retryAfterSeconds: Math.min(
        86400,
        Math.max(30, Number.isFinite(seconds) ? seconds : 60),
      ),
      reason: "Poskytovateľ dočasne neprijal upozornenie.",
    };
  }
  return {
    status: "failed",
    httpStatus: response.status,
    reason: "Poskytovateľ odmietol upozornenie; skontroluj konfiguráciu.",
  };
}
/** Uses maintained RFC 8291 / RFC 8292 implementation; no custom cryptography. */
export async function sendPush(
  input: unknown,
  message: PushPayload,
  config: PushConfiguration,
  transport: typeof fetch = fetch,
): Promise<SendResult> {
  let subscription: StoredPushSubscription;
  try {
    subscription = validateSubscription(input);
  } catch {
    return {
      status: "failed",
      httpStatus: null,
      reason: "Neplatný odber upozornení.",
    };
  }
  if (subscription.expirationTime && subscription.expirationTime < Date.now())
    return { status: "expired", httpStatus: 410 };
  if (
    !config.publicKey ||
    !config.privateKey ||
    !/^(mailto:[^\s@]+@[^\s@]+|https:\/\/[^\s]+)$/.test(config.subject)
  ) {
    return {
      status: "failed",
      httpStatus: null,
      reason: "Web push zatiaľ nie je nakonfigurovaný.",
    };
  }
  let request: Awaited<ReturnType<typeof buildPushPayload>>;
  try {
    request = await buildPushPayload(
      {
        data: {
          // Generic default keeps message content private on shared devices/lock screens.
          title: (message.title || "Cestou Zimy").slice(0, 100),
          body: (
            message.body ||
            "Organizátor ti poslal novú správu. Otvor ju v aplikácii."
          ).slice(0, 400),
          url: notificationPath(message.messageId, config.applicationUrl),
          tag: `cz-message-${message.messageId.slice(0, 100)}`,
        },
        options: { ttl: 86400, urgency: "normal" },
      },
      subscription,
      config,
    );
  } catch {
    return {
      status: "failed",
      httpStatus: null,
      reason:
        "Upozornenie sa nepodarilo bezpečne pripraviť. Skontroluj odber a VAPID kľúče.",
    };
  }
  try {
    const response = await transport(subscription.endpoint, {
      ...request,
      redirect: "error",
      signal: AbortSignal.timeout(10000),
    });
    return classifyPushResponse(response);
  } catch {
    return {
      status: "retry",
      httpStatus: null,
      retryAfterSeconds: 60,
      reason: "Poskytovateľ upozornení je dočasne nedostupný.",
    };
  }
}

export interface InvitationConfiguration {
  apiKey: string;
  from: string;
  siteUrl: string;
}
export async function sendInvitation(
  email: string,
  nickname: string,
  courseName: string,
  idempotencyKey: string,
  config: InvitationConfiguration,
  transport: typeof fetch = fetch,
): Promise<SendResult> {
  if (!config.apiKey || !config.from)
    return {
      status: "failed",
      httpStatus: null,
      reason: "Odosielanie pozvánok e-mailom nie je nakonfigurované.",
    };
  if (
    !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email) ||
    /[\r\n]/.test(config.from)
  )
    return {
      status: "failed",
      httpStatus: null,
      reason: "Neplatná e-mailová adresa.",
    };
  let origin: URL;
  try {
    origin = new URL(config.siteUrl);
  } catch {
    return {
      status: "failed",
      httpStatus: null,
      reason: "Chýba adresa aplikácie.",
    };
  }
  if (origin.protocol !== "https:")
    return {
      status: "failed",
      httpStatus: null,
      reason: "Adresa aplikácie musí používať HTTPS.",
    };
  if (!normalizeApplicationUrl(config.siteUrl))
    return {
      status: "failed",
      httpStatus: null,
      reason: "Adresa aplikácie nie je platná.",
    };
  try {
    const response = await transport("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.apiKey}`,
        "content-type": "application/json",
        "idempotency-key": idempotencyKey,
      },
      body: JSON.stringify({
        from: config.from,
        to: [email],
        subject: `Pozvanie: ${courseName.slice(0, 120)}`,
        text: `Ahoj ${nickname.slice(0, 80)},\n\norganizátor ťa pozýva do prípravy ${courseName.slice(0, 120)}.\n\nOtvor ${normalizeApplicationUrl(config.siteUrl)}/ a prihlás sa e-mailovou adresou, na ktorú prišlo toto pozvanie. Tvoja identita a aktívne členstvo sa overia pri každom prístupe.\n\nPríprava je dobrovoľná. Tešíme sa na spoločnú cestu!\nCestou Zimy`,
      }),
      redirect: "error",
      signal: AbortSignal.timeout(10000),
    });
    return classifyPushResponse(response);
  } catch {
    return {
      status: "retry",
      httpStatus: null,
      retryAfterSeconds: 60,
      reason: "E-mailová služba je dočasne nedostupná.",
    };
  }
}
