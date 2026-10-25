import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { readFile, stat } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { SQLiteDatabase, migrateApp } from "./sqlite.ts";
import {
  createAuth,
  authSettingsFromEnv,
  createMailer,
  migrateAuth,
} from "./auth.ts";
import { handleRequest, type ServerConfig } from "../lib/server.ts";
import { drainOutbox, type OutboxConfig } from "../lib/outbox.ts";
import type { Identity } from "../lib/types.ts";
import { createManifest } from "../scripts/pwa-assets.mjs";
import {
  APP_BASE_PATH,
  appPath,
  stripAppPath,
  basePathFromUrl,
  type AppBasePath,
} from "../lib/paths.ts";

const AUTH_ROUTES = new Map([
  ["/api/auth/email-otp/send-verification-otp", "POST"],
  ["/api/auth/sign-in/email-otp", "POST"],
  ["/api/auth/sign-out", "POST"],
  ["/api/auth/get-session", "GET"],
]);
export function createApiHandler(
  db: SQLiteDatabase,
  auth: ReturnType<typeof createAuth>,
  config: ServerConfig,
) {
  if (!config.siteUrl)
    throw new Error("API konfigurácia vyžaduje úplnú siteUrl z APP_URL.");
  const basePath = basePathFromUrl(config.siteUrl);
  if (auth.options.basePath !== appPath("/api/auth", basePath))
    throw new Error("Prihlasovanie a API používajú rozdielnu cestu aplikácie.");
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url),
      fullPath = url.pathname;
    if (fullPath === "/healthz") {
      db.native.prepare("SELECT 1").get();
      return Response.json(
        { ok: true },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    const path = stripAppPath(fullPath, basePath);
    if (path === null || !path.startsWith("/api/"))
      return Response.json(
        { error: "Stránka sa nenašla." },
        { status: 404, headers: { "Cache-Control": "no-store" } },
      );
    if (path.startsWith("/api/auth/")) {
      if (AUTH_ROUTES.get(path) !== request.method)
        return Response.json(
          { error: "Nepodporovaná prihlasovacia operácia." },
          { status: 404, headers: { "Cache-Control": "no-store" } },
        );
      const response = await auth.handler(request);
      response.headers.set("Cache-Control", "private, no-store");
      return response;
    }
    const sessionResponse = await auth.api.getSession({
      headers: request.headers,
      asResponse: true,
    });
    const session = await sessionResponse.json();
    const identity: Identity | null = session?.user?.emailVerified
      ? {
          userId: session.user.id,
          email: session.user.email,
          displayName: session.user.name,
        }
      : null;
    url.pathname = path;
    const response = await handleRequest(
      new Request(url, request),
      identity,
      db,
      config,
    );
    for (const cookie of sessionResponse.headers.getSetCookie())
      response.headers.append("Set-Cookie", cookie);
    return response;
  };
}
async function bodyOf(request: IncomingMessage): Promise<Buffer | undefined> {
  if (request.method === "GET" || request.method === "HEAD") return;
  if (Number(request.headers["content-length"] || 0) > 65536)
    throw Object.assign(new Error("Príliš veľká požiadavka."), { status: 413 });
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 65536)
      throw Object.assign(new Error("Príliš veľká požiadavka."), {
        status: 413,
      });
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}
async function writeResponse(response: Response, res: ServerResponse) {
  res.statusCode = response.status;
  response.headers.forEach((value, key) => {
    if (key.toLowerCase() !== "set-cookie") res.setHeader(key, value);
  });
  const cookies = response.headers.getSetCookie();
  if (cookies.length) res.setHeader("Set-Cookie", cookies);
  res.end(Buffer.from(await response.arrayBuffer()));
}
const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".gif": "image/gif",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".ico": "image/x-icon",
};

export async function assertBuildConfiguration(
  basePath: AppBasePath,
  directory = resolve("dist/client"),
) {
  let metadata: unknown;
  try {
    metadata = JSON.parse(
      await readFile(resolve(directory, "build-config.json"), "utf8"),
    );
  } catch {
    throw new Error(
      "Chýba platný build-config.json. Zostav frontend s rovnakým APP_URL ako server.",
    );
  }
  if ((metadata as { appBasePath?: unknown })?.appBasePath !== basePath)
    throw new Error(
      "Cesta frontend buildu sa nezhoduje s APP_URL servera. Zopakuj build a nasadenie s rovnakým APP_URL.",
    );
}

export async function startServer() {
  try {
    process.loadEnvFile(".env");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  process.umask(0o077);
  const arg = (name: string) => {
    const index = process.argv.indexOf(name);
    return index >= 0 ? process.argv[index + 1] : undefined;
  };
  const port = Number(arg("--port") || process.env.PORT || 3000),
    host = arg("--host") || process.env.HOST || "127.0.0.1";
  const development = process.env.NODE_ENV !== "production";
  if (!process.env.APP_URL && development)
    process.env.APP_URL = `http://localhost:${port}${APP_BASE_PATH}`;
  const settings = authSettingsFromEnv(),
    basePath = basePathFromUrl(settings.appUrl);
  if (!development) await assertBuildConfiguration(basePath);
  if (development)
    settings.trustedOrigins = [
      ...(settings.trustedOrigins || []),
      `http://localhost:${port}`,
      `http://127.0.0.1:${port}`,
      `http://terminal.local:${port}`,
      "http://terminal.local",
    ];
  const db = new SQLiteDatabase(
    process.env.DATABASE_PATH || ".data/cestou-zimy.sqlite",
  );
  const migrations = migrateApp(db),
    mail = createMailer(settings),
    auth = createAuth(db, settings, mail);
  await migrateAuth(auth);
  const config: OutboxConfig = {
    courseId: settings.courseId,
    bootstrapAdminEmail: settings.bootstrapAdminEmail,
    siteUrl: settings.appUrl,
    vapidPublicKey: process.env.VAPID_PUBLIC_KEY,
    vapidPrivateKey: process.env.VAPID_PRIVATE_KEY,
    vapidSubject: process.env.VAPID_SUBJECT,
    emailEnabled: settings.mailMode === "file" || !!settings.smtpHost,
    emailFrom: settings.mailFrom,
    invitationSender: async (payload) => {
      try {
        await mail({
          to: payload.to,
          subject: `Pozvánka · ${payload.courseName}`,
          text: `Ahoj ${payload.nickname},\n\nmáš pozvánku do prípravy ${payload.courseName}. Prihlás sa touto e-mailovou adresou na ${payload.siteUrl}. Prihlasovací kód si vyžiadaš priamo v aplikácii.\n\nCestou Zimy`,
          messageId: `<${payload.idempotencyKey.replace(/[^a-z0-9-]/gi, "")}@${new URL(settings.appUrl).hostname}>`,
        });
        return { status: "accepted", httpStatus: 250 };
      } catch (error) {
        const code = Number(
          (error as { responseCode?: number }).responseCode || 0,
        );
        return code >= 500
          ? {
              status: "failed",
              httpStatus: code,
              reason: "SMTP server odmietol pozvánku.",
            }
          : {
              status: "retry",
              httpStatus: code || null,
              retryAfterSeconds: 60,
              reason: "SMTP odoslanie sa nepodarilo; server ho zopakuje.",
            };
      }
    },
  };
  const api = createApiHandler(db, auth, config);
  let vite:
    | Awaited<ReturnType<(typeof import("vite"))["createServer"]>>
    | undefined;
  if (development) {
    const { createServer: createVite } = await import("vite");
    vite = await createVite({
      configFile: resolve("app-vite.config.ts"),
      server: { middlewareMode: true, hmr: false },
      appType: "custom",
    });
  }
  const allowedHosts = new Set([
    new URL(settings.appUrl).host,
    ...(settings.trustedOrigins || []).map((origin) => new URL(origin).host),
  ]);
  const server = createServer(async (req, res) => {
    try {
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Referrer-Policy", "same-origin");
      if (!development) {
        res.setHeader("X-Frame-Options", "DENY");
        res.setHeader(
          "Content-Security-Policy",
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
        );
      }
      const path = new URL(req.url || "/", settings.appUrl).pathname;
      if (path === "/healthz") {
        db.native.prepare("SELECT 1").get();
        res.setHeader("Cache-Control", "no-store");
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ ok: true }));
        return;
      }
      const requestHost = req.headers.host || "";
      if (!allowedHosts.has(requestHost)) {
        res.writeHead(400);
        res.end("Neplatná adresa servera.");
        return;
      }
      const applicationPath = stripAppPath(path, basePath);
      if (applicationPath?.startsWith("/api/")) {
        const headers = new Headers();
        for (const [key, value] of Object.entries(req.headers)) {
          if (value !== undefined)
            headers.set(key, Array.isArray(value) ? value.join(",") : value);
        }
        headers.delete("x-forwarded-for");
        headers.set(
          "x-real-ip",
          process.env.TRUST_PROXY === "1" &&
            typeof req.headers["x-real-ip"] === "string"
            ? req.headers["x-real-ip"]
            : req.socket.remoteAddress || "127.0.0.1",
        );
        const origin = development
          ? `http://${requestHost}`
          : new URL(settings.appUrl).origin;
        const rawBody = await bodyOf(req);
        const request = new Request(new URL(req.url || "/", origin), {
          method: req.method,
          headers,
          body: rawBody ? Uint8Array.from(rawBody).buffer : undefined,
        });
        await writeResponse(await api(request), res);
        return;
      }
      if (req.method !== "GET" && req.method !== "HEAD") {
        res.writeHead(405);
        res.end();
        return;
      }
      if (applicationPath === "/manifest.webmanifest") {
        res.setHeader("Content-Type", "application/manifest+json");
        res.setHeader("Cache-Control", "no-store");
        res.end(
          req.method === "HEAD"
            ? undefined
            : JSON.stringify(createManifest(basePath)),
        );
        return;
      }
      if (
        development &&
        process.env.ENABLE_VISUAL_QA === "1" &&
        (path === appPath("/__visual", basePath) ||
          path === appPath("/__visual-data", basePath))
      ) {
        res.setHeader("Cache-Control", "no-store");
        if (path.endsWith("__visual-data")) {
          const fixture = JSON.parse(
            await readFile(resolve(".data/visual-state.json"), "utf8"),
          );
          if (
            !fixture.admin?.course?.testMode ||
            !fixture.participant?.course?.testMode ||
            fixture.adminData?.members?.some(
              (m: { email?: string }) => !m.email?.endsWith("@example.test"),
            )
          )
            throw new Error("Visual QA accepts fictional test data only");
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify(fixture));
          return;
        }
        const template =
          '<!doctype html><html lang="sk"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Cestou Zimy · vizuálny test</title></head><body><div id="root"></div><script type="module" src="' +
          "/tests/visual-harness.tsx" +
          '"></script></body></html>';
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.end(await vite!.transformIndexHtml(req.url || "/", template));
        return;
      }
      if (development && path === "/__qa") {
        const query = new URL(req.url || "/", settings.appUrl).searchParams;
        const width = Math.max(
            320,
            Math.min(2560, Number(query.get("width")) || 390),
          ),
          height = Math.max(
            400,
            Math.min(1600, Number(query.get("height")) || 844),
          );
        const scale = Math.min(1, 1280 / width);
        const source =
          query.get("src") === "/__visual"
            ? appPath("/__visual", basePath)
            : appPath("/", basePath);
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.setHeader("Cache-Control", "no-store");
        res.end(
          `<!doctype html><html><head><title>Cestou Zimy · kontrola rozmeru</title></head><body style="margin:0;background:#e8eeee;font-family:sans-serif"><p style="margin:12px">Vývojová kontrola ${width} × ${height} px · náhľad ${Math.round(scale * 100)} %</p><iframe title="Aplikácia vo vybranom rozmere" src="${source}" style="width:${width}px;height:${height}px;border:1px solid #588d8c;margin:0 12px;transform:scale(${scale});transform-origin:top left"></iframe></body></html>`,
        );
        return;
      }
      if (path === "/" || path === basePath) {
        res.writeHead(308, {
          Location:
            appPath("/", basePath) +
            new URL(req.url || "/", settings.appUrl).search,
          "Cache-Control": "no-store",
        });
        res.end();
        return;
      }
      if (applicationPath === null) {
        res.writeHead(404);
        res.end();
        return;
      }
      if (vite) {
        await new Promise<void>((resolveNext, reject) =>
          vite!.middlewares(req, res, (error: unknown) =>
            error ? reject(error) : resolveNext(),
          ),
        );
        if (res.writableEnded) return;
        const template = await readFile(resolve("index.html"), "utf8"),
          html = await vite.transformIndexHtml(req.url || "/", template);
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.setHeader("Cache-Control", "no-store");
        res.end(req.method === "HEAD" ? undefined : html);
        return;
      }
      const directory = resolve("dist/client"),
        decoded = decodeURIComponent(applicationPath),
        candidate = resolve(directory, "." + decoded);
      if (
        (!candidate.startsWith(directory + sep) && candidate !== directory) ||
        decoded.split("/").some((part) => part.startsWith("."))
      ) {
        res.writeHead(404);
        res.end();
        return;
      }
      let file = candidate;
      try {
        if (!(await stat(file)).isFile()) throw new Error("not file");
      } catch {
        if (extname(decoded)) {
          res.writeHead(404);
          res.end();
          return;
        }
        file = joinPath(directory, "index.html");
      }
      res.setHeader(
        "Content-Type",
        MIME[extname(file)] || "application/octet-stream",
      );
      res.setHeader(
        "Cache-Control",
        file.includes(sep + "assets" + sep)
          ? "public, max-age=31536000, immutable"
          : "no-store",
      );
      res.end(req.method === "HEAD" ? undefined : await readFile(file));
    } catch (error) {
      if (!res.headersSent)
        res.writeHead(Number((error as { status?: number }).status) || 500, {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
        });
      res.end(
        JSON.stringify({
          error: "Server požiadavku nedokončil. Skús to znova.",
        }),
      );
      console.error(
        "HTTP request failed:",
        error instanceof Error ? error.name : "unknown",
      );
    }
  });
  let draining: Promise<unknown> | null = null;
  const drain = () => {
    if (draining) return;
    draining = drainOutbox(db, config)
      .catch((error) =>
        console.error(
          "Outbox processing failed:",
          error instanceof Error ? error.name : "unknown",
        ),
      )
      .finally(() => {
        draining = null;
      });
  };
  const timer = setInterval(drain, 30000);
  timer.unref();
  drain();
  await new Promise<void>((resolveStart) =>
    server.listen(port, host, resolveStart),
  );
  console.log(
    `Cestou Zimy počúva na ${host}:${port}; nové migrácie: ${migrations.length}; režim: ${development ? "vývoj" : "produkcia"}.`,
  );
  const close = async () => {
    clearInterval(timer);
    await new Promise<void>((resolveClose) =>
      server.close(() => resolveClose()),
    );
    await draining;
    await vite?.close();
    db.close();
  };
  for (const signal of ["SIGINT", "SIGTERM"] as const)
    process.once(signal, () => {
      void close().then(() => process.exit(0));
    });
  return { server, db, auth, close };
}
const joinPath = (directory: string, file: string) => resolve(directory, file);
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  await startServer();
}
