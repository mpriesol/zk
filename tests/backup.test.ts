import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

test("online WAL backup and explicit offline restore preserve recoverable previous state", () => {
  const dir = mkdtempSync(join(tmpdir(), "zk-backup-"));
  const file = join(dir, "source.sqlite");
  const snapshot = join(dir, "backup.sqlite");
  const env = { ...process.env, DATABASE_PATH: file };
  const backupScript = new URL("../scripts/backup.mjs", import.meta.url);
  const restoreScript = new URL("../scripts/restore.mjs", import.meta.url);
  const run = (script: URL, ...args: string[]) =>
    spawnSync(process.execPath, [script.pathname, ...args], {
      env,
      encoding: "utf8",
    });
  try {
    const db = new DatabaseSync(file);
    db.exec(
      "PRAGMA journal_mode=WAL; CREATE TABLE courses(id TEXT PRIMARY KEY); INSERT INTO courses VALUES('original');",
    );
    const saved = run(backupScript, snapshot);
    assert.equal(saved.status, 0, saved.stderr);
    assert.equal(statSync(snapshot).mode & 0o777, 0o600);
    assert.notEqual(
      run(backupScript, snapshot).status,
      0,
      "cannot overwrite an existing backup",
    );
    db.exec("INSERT INTO courses VALUES('newer');");
    db.close();
    assert.notEqual(
      run(restoreScript, snapshot).status,
      0,
      "must explicitly confirm the app is stopped",
    );
    const unchanged = new DatabaseSync(file);
    assert.equal(
      unchanged.prepare("SELECT COUNT(*) AS n FROM courses").get()!.n,
      2,
    );
    unchanged.close();
    const restored = run(restoreScript, snapshot, "--confirm-stopped");
    assert.equal(restored.status, 0, restored.stderr);
    const result = new DatabaseSync(file);
    assert.equal(
      result.prepare("SELECT COUNT(*) AS n FROM courses").get()!.n,
      1,
    );
    assert.equal(
      result.prepare("SELECT id FROM courses").get()!.id,
      "original",
    );
    result.close();
    const preserved = readdirSync(dir).find((name) =>
      name.includes(".before-restore-"),
    )!;
    assert.ok(preserved);
    const before = new DatabaseSync(join(dir, preserved));
    assert.equal(
      before.prepare("SELECT COUNT(*) AS n FROM courses").get()!.n,
      2,
    );
    before.close();
    const unrelated = join(dir, "unrelated.sqlite");
    const other = new DatabaseSync(unrelated);
    other.exec("CREATE TABLE unrelated(id INTEGER)");
    other.close();
    assert.notEqual(
      run(restoreScript, unrelated, "--confirm-stopped").status,
      0,
      "unrelated databases are rejected",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Caddy rendering selects Hub, public path or separate subdomain from APP_URL and rejects injection", () => {
  const script = new URL("../scripts/render-caddy.mjs", import.meta.url)
    .pathname;
  const run = (appUrl: string) =>
    spawnSync(process.execPath, [script], {
      env: { ...process.env, APP_URL: appUrl },
      encoding: "utf8",
    });
  assert.notEqual(run("").status, 0);
  assert.notEqual(
    run("https://hub.biketrek.sk/zk\n{ respond hacked }").status,
    0,
  );
  assert.notEqual(run("https://evil.example/zk").status, 0);
  const hub = run("https://hub.biketrek.sk/zk");
  assert.equal(hub.status, 0, hub.stderr);
  assert.match(hub.stdout, /header_up Host hub\.biketrek\.sk/);
  assert.doesNotMatch(hub.stdout, /uri path_regexp/);
  const valid = run("https://zimnykurz.sk/priprava");
  assert.equal(valid.status, 0, valid.stderr);
  assert.match(valid.stdout, /path \/zk \/zk\/\*/);
  assert.match(valid.stdout, /uri path_regexp \^\/zk \/priprava/);
  assert.match(valid.stdout, /header_up Host zimnykurz\.sk/);
  assert.match(valid.stdout, /header_up X-Real-IP \{client_ip\}/);
  assert.match(valid.stdout, /reverse_proxy zk-app:3000/);
  assert.doesNotMatch(valid.stdout, /respond hacked|example\.test/);
  const subdomain = run("https://priprava.zimnykurz.sk/");
  assert.equal(subdomain.status, 0, subdomain.stderr);
  assert.match(subdomain.stdout, /^priprava\.zimnykurz\.sk\s*\{/m);
  assert.match(subdomain.stdout, /header_up Host priprava\.zimnykurz\.sk/);
  assert.match(
    subdomain.stdout,
    /header_up X-Forwarded-Host priprava\.zimnykurz\.sk/,
  );
  assert.match(subdomain.stdout, /header_up X-Real-IP \{client_ip\}/);
  assert.match(subdomain.stdout, /reverse_proxy zk-app:3000/);
  assert.doesNotMatch(
    subdomain.stdout,
    /uri path_regexp|handle_path|@cestouZimyGateway/,
  );
  assert.notEqual(run("https://priprava.zimnykurz.sk/zk").status, 0);
  assert.notEqual(run("https://priprava.zimnykurz.sk.example.test").status, 0);
});
