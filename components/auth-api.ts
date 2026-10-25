import { appPath } from "../lib/paths";

export interface AccountInfo {
  username: string | null;
  hasPassword: boolean;
  membership: "active" | "pending" | "revoked" | "none";
}
export interface AuthOptions {
  password: boolean;
  emailOtp: boolean;
  registrationOpen: boolean;
}

const errorMessages: Record<string, string> = {
  INVALID_USERNAME_OR_PASSWORD: "Meno alebo heslo nesedia. Skús to znova.",
  INVALID_EMAIL_OR_PASSWORD: "Meno alebo heslo nesedia. Skús to znova.",
  INVALID_PASSWORD: "Súčasné heslo nesedí. Skús to znova.",
  USERNAME_IS_ALREADY_TAKEN:
    "Toto prihlasovacie meno už niekto používa. Vyber si iné.",
  USER_ALREADY_EXISTS: "Takýto účet už existuje. Skús sa prihlásiť.",
  USERNAME_TOO_SHORT: "Prihlasovacie meno musí mať aspoň 3 znaky.",
  USERNAME_TOO_LONG: "Prihlasovacie meno môže mať najviac 32 znakov.",
  INVALID_USERNAME:
    "Použi písmená, čísla, medzery, bodku, pomlčku alebo podčiarkovník. Začni písmenom alebo číslom.",
  PASSWORD_TOO_SHORT: "Heslo musí mať aspoň 10 znakov.",
  PASSWORD_TOO_LONG: "Heslo môže mať najviac 128 znakov.",
  INVALID_OTP:
    "Kód je nesprávny, vypršal alebo už bol použitý. Vyžiadaj si nový kód.",
  OTP_EXPIRED: "Kód už vypršal. Vyžiadaj si nový kód.",
  TOO_MANY_ATTEMPTS: "Príliš veľa pokusov. Vyžiadaj si nový kód.",
  OTP_NOT_FOUND:
    "Kód je nesprávny, vypršal alebo už bol použitý. Vyžiadaj si nový kód.",
  INVALID_TOKEN:
    "Odkaz alebo kód už neplatí. Vyžiadaj si nový od organizátora.",
  FRESH_SESSION_REQUIRED:
    "Pred zmenou hesla sa z bezpečnostných dôvodov odhlás a znovu prihlás.",
  SESSION_EXPIRED: "Z bezpečnostných dôvodov sa najprv znovu prihlás.",
};

export async function authRequest<T = Record<string, unknown>>(
  path: string,
  body?: Record<string, unknown>,
): Promise<T> {
  const response = await fetch(appPath(path), {
    method: body === undefined ? "GET" : "POST",
    headers:
      body === undefined ? undefined : { "Content-Type": "application/json" },
    credentials: "same-origin",
    cache: "no-store",
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data: any;
  try {
    data = await response.json();
  } catch {
    throw new Error(
      "Server neodpovedal. Skontroluj pripojenie a skús to znova.",
    );
  }
  if (!response.ok) {
    if (response.status === 429)
      throw new Error("Príliš veľa pokusov. Skús to neskôr.");
    const code = data?.code || data?.error?.code;
    const known = typeof code === "string" ? errorMessages[code] : undefined;
    if (known) throw new Error(known);
    // Application routes return curated Slovak errors; library errors use codes above.
    if (!path.startsWith("/api/auth/") && typeof data?.error === "string")
      throw new Error(data.error);
    throw new Error(
      response.status === 503
        ? "Prihlásenie momentálne nie je dostupné. Skús to neskôr alebo sa ozvi organizátorovi."
        : "Požiadavku sa nepodarilo dokončiť. Skontroluj údaje a skús to znova.",
    );
  }
  return data as T;
}

export function authLinkToken(kind: "invite" | "reset"): string | null {
  if (typeof window === "undefined") return null;
  const token = new URLSearchParams(window.location.hash.slice(1)).get(kind);
  return token && token.length <= 512 ? token : null;
}
export function clearAuthLink(kind: "invite" | "reset") {
  const url = new URL(window.location.href);
  const fragment = new URLSearchParams(url.hash.slice(1));
  fragment.delete(kind);
  url.hash = fragment.toString();
  history.replaceState(null, "", url);
}
