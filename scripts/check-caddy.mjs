// Optional local integration check. Requires an official Caddy binary in PATH or CADDY_BIN.
// No Docker, production config, external network request or real account is used.
import { createServer, request as httpRequest } from "node:http";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";

const binary = process.env.CADDY_BIN || "caddy";
const version = spawnSync(binary, ["version"], { encoding: "utf8" });
if (version.status !== 0)
  throw new Error(
    "Caddy nie je dostupný. Nastav CADDY_BIN na oficiálny lokálny Caddy executable.",
  );
console.log(version.stdout.trim());
let totalChecks = 0;
for (const canonical of [
  "https://hub.biketrek.sk/zk",
  "https://zimnykurz.sk/priprava",
  "https://priprava.zimnykurz.sk",
]) {
  const canonicalUrl = new URL(canonical);
  const base = canonicalUrl.pathname.replace(/\/$/, "");
  const hostname = canonicalUrl.hostname;
  const separateSite = base === "";
  const gatewayHost = separateSite ? hostname : "hub.biketrek.sk";
  let checks = 0;
  const pass = (message) => {
    checks++;
    console.log(`PASS ${message}`);
  };
  console.log(`Testing APP_URL=${canonical}`);
  const rendered = spawnSync(
    process.execPath,
    [new URL("./render-caddy.mjs", import.meta.url).pathname],
    { encoding: "utf8", env: { ...process.env, APP_URL: canonical } },
  );
  assert.equal(rendered.status, 0, rendered.stderr);
  const directory = mkdtempSync(join(tmpdir(), "zk-caddy-"));
  let upstreamRequests = 0;
  const stub = createServer(async (request, response) => {
    upstreamRequests++;
    let body = "";
    for await (const chunk of request) body += chunk;
    response.setHeader("content-type", "application/json");
    response.setHeader("server", "test-upstream");
    response.end(
      JSON.stringify({
        url: request.url,
        method: request.method,
        body,
        host: request.headers.host,
        forwardedHost: request.headers["x-forwarded-host"],
        forwardedFor: request.headers["x-forwarded-for"],
        origin: request.headers.origin,
        ip: request.headers["x-real-ip"],
        proto: request.headers["x-forwarded-proto"],
        identity: request.headers["oai-authenticated-user-id"],
        email: request.headers["oai-authenticated-user-email"],
        name: request.headers["oai-authenticated-user-full-name"],
      }),
    );
  });
  await new Promise((resolve) => stub.listen(0, "127.0.0.1", resolve));
  const stubPort = stub.address().port;
  const reserve = createServer();
  await new Promise((resolve) => reserve.listen(0, "127.0.0.1", resolve));
  const gatewayPort = reserve.address().port;
  await new Promise((resolve) => reserve.close(resolve));
  let snippet = rendered.stdout.replace("zk-app:3000", `127.0.0.1:${stubPort}`);
  if (separateSite) {
    assert.match(snippet, /^priprava\.zimnykurz\.sk\s*\{/m);
    // Keep the real host matcher, but bind HTTP to a private loopback port.
    // No DNS resolution, certificate issuance or public listener is needed.
    snippet = snippet.replace(
      /^priprava\.zimnykurz\.sk\s*\{/m,
      `http://priprava.zimnykurz.sk:${gatewayPort} {\n bind 127.0.0.1`,
    );
  }
  const hubSnippet = separateSite
    ? readFileSync(
        new URL("../deploy/Caddyfile.zk.redirect", import.meta.url),
        "utf8",
      )
    : snippet;
  const config = join(directory, "Caddyfile");
  writeFileSync(
    config,
    `{\n admin off\n auto_https off\n}\nhttp://hub.biketrek.sk:${gatewayPort} {\n bind 127.0.0.1\n${hubSnippet}\n handle /api/* {\n respond "hub-api"\n }\n handle /sps/* {\n respond "sps"\n }\n handle /data/* {\n respond "hub-data"\n }\n handle {\n respond "hub-spa"\n }\n}\nhttp://sps.example.test:${gatewayPort} {\n bind 127.0.0.1\n respond "sps-site"\n}\n${separateSite ? snippet : ""}\n`,
  );
  let child;
  try {
    const adapted = spawnSync(
      binary,
      ["adapt", "--config", config, "--adapter", "caddyfile"],
      { encoding: "utf8" },
    );
    assert.equal(adapted.status, 0, adapted.stderr);
    child = spawn(
      binary,
      ["run", "--config", config, "--adapter", "caddyfile"],
      {
        stdio: ["ignore", "ignore", "pipe"],
        env: {
          ...process.env,
          XDG_CONFIG_HOME: join(directory, "config"),
          XDG_DATA_HOME: join(directory, "data"),
        },
      },
    );
    let logs = "";
    child.stderr.on("data", (value) => {
      logs += value;
    });
    // Native HTTP permits explicit Host while keeping every connection on loopback.
    // Fetch filters this header and would not exercise the Caddy site matchers.
    const request = (path, options = {}, host = gatewayHost) =>
      new Promise((resolve, reject) => {
        const outgoing = httpRequest(
          {
            hostname: "127.0.0.1",
            port: gatewayPort,
            path,
            method: options.method || "GET",
            headers: { ...options.headers, Host: host },
          },
          (response) => {
            const chunks = [];
            response.on("data", (chunk) => chunks.push(chunk));
            response.on("error", reject);
            response.on("end", () => {
              const body = Buffer.concat(chunks).toString("utf8");
              resolve({
                status: response.statusCode,
                headers: {
                  get: (key) => response.headers[key.toLowerCase()] ?? null,
                },
                text: async () => body,
                json: async () => JSON.parse(body),
              });
            });
          },
        );
        outgoing.setTimeout(5000, () =>
          outgoing.destroy(new Error("Local Caddy request timed out")),
        );
        outgoing.on("error", reject);
        outgoing.end(options.body);
      });
    let ready = false;
    for (let attempt = 0; attempt < 50; attempt++) {
      try {
        await (await request("/")).text();
        ready = true;
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
    assert.ok(ready, logs);
    const routeCases = separateSite
      ? [
          "/",
          "/api/auth-options",
          "/api/state?week=2026-10-19",
          "/api/auth/get-session",
          "/sw.js",
        ].map((path) => [path, path])
      : [
          ["/zk", base],
          ["/zk/", base + "/"],
          [
            "/zk/api/state?week=2026-10-19",
            base + "/api/state?week=2026-10-19",
          ],
          ["/zk/api/auth/get-session", base + "/api/auth/get-session"],
          ["/zk/sw.js", base + "/sw.js"],
        ];
    for (const [path, expected] of routeCases) {
      const response = await request(path, {
        headers: {
          Origin: canonicalUrl.origin,
          "X-Real-IP": "1.2.3.4",
          "X-Forwarded-For": "1.2.3.4",
          "X-Forwarded-Host": "spoofed.example.test",
          "X-Forwarded-Proto": "http",
          "Oai-Authenticated-User-Id": "spoofed",
          "Oai-Authenticated-User-Email": "spoofed@example.test",
          "Oai-Authenticated-User-Full-Name": "Spoofed identity",
        },
      });
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("x-content-type-options"), "nosniff");
      assert.equal(response.headers.get("referrer-policy"), "same-origin");
      assert.equal(response.headers.get("server"), null);
      const result = await response.json();
      assert.equal(result.url, expected);
      assert.equal(result.host, hostname);
      assert.equal(result.forwardedHost, hostname);
      assert.equal(result.forwardedFor, "127.0.0.1");
      assert.equal(result.origin, canonicalUrl.origin);
      assert.equal(result.proto, "https");
      assert.equal(result.ip, "127.0.0.1");
      assert.equal(result.identity, undefined);
      assert.equal(result.email, undefined);
      assert.equal(result.name, undefined);
      pass(
        `${path} -> ${expected}; canonical/security headers, spoofed IP/identity ignored`,
      );
    }
    for (const [path, expected] of [
      ["/api/foo", "hub-api"],
      ["/sps/foo", "sps"],
      ["/data/foo", "hub-data"],
      ["/zk-other", "hub-spa"],
      ["/", "hub-spa"],
    ]) {
      const before = upstreamRequests;
      assert.equal(
        await (await request(path, {}, "hub.biketrek.sk")).text(),
        expected,
      );
      assert.equal(upstreamRequests, before);
      pass(`existing Hub route preserved: ${path}`);
    }
    if (separateSite) {
      for (const [path, destination] of [
        ["/zk", canonical + "/"],
        ["/zk/foo?x=1", canonical + "/foo?x=1"],
      ]) {
        const before = upstreamRequests;
        const response = await request(path, {}, "hub.biketrek.sk");
        assert.equal(response.status, 308);
        assert.equal(response.headers.get("location"), destination);
        await response.text();
        assert.equal(upstreamRequests, before);
        pass(`old Hub URL redirects to canonical subdomain: ${path}`);
      }
    }
    const beforeIsolation = upstreamRequests;
    assert.equal(
      await (await request("/zk/api/state", {}, "sps.example.test")).text(),
      "sps-site",
    );
    assert.equal(upstreamRequests, beforeIsolation);
    pass("separate SPS site remains isolated");
    await (await request("/api/state", {}, "unrelated.example.test")).text();
    assert.equal(upstreamRequests, beforeIsolation);
    pass("unrelated Host never reaches the application");
    const post = await (
      await request((separateSite ? "" : "/zk") + "/api/test?x=1", {
        method: "POST",
        headers: {
          Origin: "https://untrusted.example.test",
          "content-type": "application/json",
        },
        body: '{"test":true}',
      })
    ).json();
    assert.equal(post.method, "POST");
    assert.equal(post.body, '{"test":true}');
    assert.equal(post.url, base + "/api/test?x=1");
    assert.equal(post.origin, "https://untrusted.example.test");
    pass(
      "POST body, query and browser Origin preserved for application CSRF validation",
    );
    totalChecks += checks;
    console.log(`${checks} local gateway checks passed for ${canonical}.`);
  } finally {
    if (child && child.exitCode === null) {
      child.kill("SIGTERM");
      await new Promise((resolve) => child.once("exit", resolve));
    }
    await new Promise((resolve) => stub.close(resolve));
    rmSync(directory, { recursive: true, force: true });
  }
}
console.log(
  `All three APP_URL modes: ${totalChecks} live local gateway checks passed.`,
);
