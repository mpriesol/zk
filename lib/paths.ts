/** APP_URL selects the Hub prefix, legacy public prefix, or dedicated subdomain root. */
export type AppBasePath = "" | "/zk" | "/priprava";
declare const __CZ_BASE_PATH__: string | undefined;
const HISTORICAL_BASES = ["/zk", "/priprava"] as const;
const BASES: AppBasePath[] = ["", ...HISTORICAL_BASES];
function checkedBase(value: string): AppBasePath {
  if (!BASES.includes(value as AppBasePath))
    throw new Error(
      "Podporované cesty aplikácie sú koreň domény, /zk a /priprava.",
    );
  return value as AppBasePath;
}
export function basePathFromUrl(value: string): AppBasePath {
  const url = new URL(value),
    path = url.pathname.endsWith("/")
      ? url.pathname.slice(0, -1)
      : url.pathname;
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error(
      "APP_URL musí byť úplná http(s) adresa bez prihlasovacích údajov, parametrov a fragmentu.",
    );
  return checkedBase(path);
}
export const APP_BASE_PATH: AppBasePath =
  typeof __CZ_BASE_PATH__ !== "undefined"
    ? checkedBase(__CZ_BASE_PATH__)
    : typeof process !== "undefined" && process.env.APP_URL
      ? basePathFromUrl(process.env.APP_URL)
      : "/priprava";
export function appPath(path = "/", base: AppBasePath = APP_BASE_PATH): string {
  checkedBase(base);
  if (
    !path.startsWith("/") ||
    path.startsWith("//") ||
    path.includes("\\") ||
    /[\r\n]/.test(path)
  )
    return base + "/";
  // Normalize stored app-relative links after changing origin/prefix; this does not create an inbound HTTP alias.
  for (const previous of HISTORICAL_BASES) {
    if (
      path === previous ||
      path.startsWith(previous + "/") ||
      path.startsWith(previous + "?")
    ) {
      const suffix = path.slice(previous.length);
      return base
        ? base + suffix
        : suffix.startsWith("/")
          ? suffix
          : "/" + suffix;
    }
  }
  return base + path;
}
export function stripAppPath(
  path: string,
  base: AppBasePath = APP_BASE_PATH,
): string | null {
  checkedBase(base);
  if (path === base) return "/";
  return path.startsWith(base + "/") ? path.slice(base.length) : null;
}
