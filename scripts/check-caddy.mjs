// Optional local integration check. Requires an official Caddy binary in PATH or CADDY_BIN.
// No Docker, production config, external network request or real account is used.
import { createServer } from "node:http";
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
for (const canonical of [
  "https://hub.biketrek.sk/zk",
  "https://zimnykurz.sk/priprava",
]) {
  const base = new URL(canonical).pathname;
  const hostname = new URL(canonical).hostname;
  console.log(`Testing APP_URL=${canonical}`);
  const directory = mkdtempSync(join(tmpdir(), "zk-caddy-"));
  const stub = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    response.setHeader("content-type", "application/json");
    response.end(
      JSON.stringify({
        url: request.url,
        method: request.method,
        body,
        host: request.headers.host,
        origin: request.headers.origin,
        ip: request.headers["x-real-ip"],
        proto: request.headers["x-forwarded-proto"],
        identity: request.headers["oai-authenticated-user-id"],
      }),
    );
  });
  await new Promise((resolve) => stub.listen(0, "127.0.0.1", resolve));
  const stubPort = stub.address().port;
  const reserve = createServer();
  await new Promise((resolve) => reserve.listen(0, "127.0.0.1", resolve));
  const gatewayPort = reserve.address().port;
  await new Promise((resolve) => reserve.close(resolve));
  const rendered = spawnSync(
    process.execPath,
    [new URL("./render-caddy.mjs", import.meta.url).pathname],
    { encoding: "utf8", env: { ...process.env, APP_URL: canonical } },
  );
  assert.equal(rendered.status, 0, rendered.stderr);
  const snippet = rendered.stdout.replace(
    "zk-app:3000",
    `127.0.0.1:${stubPort}`,
  );
  const config = join(directory, "Caddyfile");
  writeFileSync(
    config,
    `{\n admin off\n auto_https off\n}\nhttp://127.0.0.1:${gatewayPort} {\n${snippet}\n handle /api/* {\n respond "hub-api"\n }\n handle /sps/* {\n respond "sps"\n }\n handle /data/* {\n respond "hub-data"\n }\n handle {\n respond "hub-spa"\n }\n}\n`,
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
    const origin = `http://127.0.0.1:${gatewayPort}`;
    let ready = false;
    for (let attempt = 0; attempt < 50; attempt++) {
      try {
        await fetch(origin);
        ready = true;
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
    assert.ok(ready, logs);
    for (const [path, expected] of [
      ["/zk", base],
      ["/zk/", base + "/"],
      ["/zk/api/state?week=2026-10-19", base + "/api/state?week=2026-10-19"],
      ["/zk/api/auth/get-session", base + "/api/auth/get-session"],
      ["/zk/sw.js", base + "/sw.js"],
    ]) {
      const result = await (
        await fetch(origin + path, {
          headers: {
            Origin: new URL(canonical).origin,
            "X-Real-IP": "1.2.3.4",
            "X-Forwarded-For": "1.2.3.4",
            "Oai-Authenticated-User-Id": "spoofed",
          },
        })
      ).json();
      assert.equal(result.url, expected);
      assert.equal(result.host, hostname);
      assert.equal(result.origin, new URL(canonical).origin);
      assert.equal(result.proto, "https");
      assert.equal(result.ip, "127.0.0.1");
      assert.equal(result.identity, undefined);
      console.log(
        `PASS ${path} -> ${expected}; canonical headers, spoofed IP/identity ignored`,
      );
    }
    for (const [path, expected] of [
      ["/api/foo", "hub-api"],
      ["/sps/foo", "sps"],
      ["/data/foo", "hub-data"],
      ["/zk-other", "hub-spa"],
      ["/", "hub-spa"],
    ]) {
      assert.equal(await (await fetch(origin + path)).text(), expected);
      console.log(`PASS existing route preserved: ${path}`);
    }
    const post = await (
      await fetch(origin + "/zk/api/test?x=1", {
        method: "POST",
        headers: {
          Origin: new URL(canonical).origin,
          "content-type": "application/json",
        },
        body: '{"test":true}',
      })
    ).json();
    assert.equal(post.method, "POST");
    assert.equal(post.body, '{"test":true}');
    assert.equal(post.url, base + "/api/test?x=1");
    console.log(
      "PASS POST body and query preserved. 11 local gateway checks passed.",
    );
  } finally {
    if (child && child.exitCode === null) {
      child.kill("SIGTERM");
      await new Promise((resolve) => child.once("exit", resolve));
    }
    await new Promise((resolve) => stub.close(resolve));
    rmSync(directory, { recursive: true, force: true });
  }
}
console.log("Both APP_URL modes: 22 live local gateway checks passed.");
