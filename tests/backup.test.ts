import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createSnapshot } from "../scripts/backup.mjs";
import {
  dueBackupDay,
  schedulerMode,
  startBackupScheduler,
} from "../server/backup-scheduler.ts";

test("snapshot manifests include every referenced photo and offline restore recovers files and DB together", async () => {
  const dir = mkdtempSync(join(tmpdir(), "zk-full-backup-")),
    live = join(dir, "live"),
    media = join(live, "media"),
    backups = join(dir, "backups"),
    file = join(live, "app.sqlite");
  mkdirSync(media, { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(
    "PRAGMA journal_mode=WAL;CREATE TABLE courses(id TEXT PRIMARY KEY);INSERT INTO courses VALUES('old');CREATE TABLE media(id TEXT PRIMARY KEY,storage_name TEXT,bytes INTEGER);",
  );
  const first = randomUUID(),
    second = randomUUID(),
    image = Buffer.from("immutable-photo-first"),
    newImage = Buffer.from("immutable-photo-second");
  writeFileSync(join(media, first + ".webp"), image);
  db.prepare("INSERT INTO media VALUES(?,?,?)").run(
    first,
    first + ".webp",
    image.length,
  );
  try {
    const snapshot = await createSnapshot({
      databasePath: file,
      mediaDirectory: media,
      backupDirectory: backups,
      reason: "manual",
    });
    const manifest = JSON.parse(readFileSync(snapshot.manifest, "utf8"));
    assert.equal(manifest.media.length, 1);
    assert.equal(manifest.media[0].storageName, first + ".webp");
    assert.deepEqual(
      readFileSync(join(snapshot.assets, first + ".webp")),
      image,
    );
    db.exec("UPDATE courses SET id='new';DELETE FROM media");
    db.prepare("INSERT INTO media VALUES(?,?,?)").run(
      second,
      second + ".webp",
      newImage.length,
    );
    writeFileSync(join(media, second + ".webp"), newImage);
    rmSync(join(media, first + ".webp"));
    db.close();
    const restored = spawnSync(
      process.execPath,
      [
        new URL("../scripts/restore.mjs", import.meta.url).pathname,
        snapshot.database,
        "--confirm-stopped",
      ],
      {
        env: { ...process.env, DATABASE_PATH: file, MEDIA_DIRECTORY: media },
        encoding: "utf8",
      },
    );
    assert.equal(restored.status, 0, restored.stderr);
    assert.deepEqual(readFileSync(join(media, first + ".webp")), image);
    assert.equal(existsSync(join(media, second + ".webp")), false);
    const check = new DatabaseSync(file);
    assert.equal(check.prepare("SELECT id FROM courses").get()!.id, "old");
    assert.equal(check.prepare("SELECT id FROM media").get()!.id, first);
    check.close();
    assert.ok(
      readdirSync(live).some(
        (name) =>
          name.includes("before-restore") && name.endsWith(".manifest.json"),
      ),
    );
  } finally {
    try {
      db.close();
    } catch {}
    rmSync(dir, { recursive: true, force: true });
  }
});
test("missing media cannot finalize a snapshot or remove the last good backup; daily retention preserves manual snapshots", async () => {
  const dir = mkdtempSync(join(tmpdir(), "zk-backup-retention-")),
    file = join(dir, "app.sqlite"),
    media = join(dir, "media"),
    backups = join(dir, "backups");
  mkdirSync(media);
  const db = new DatabaseSync(file);
  db.exec(
    "CREATE TABLE courses(id TEXT);INSERT INTO courses VALUES('course');CREATE TABLE media(id TEXT PRIMARY KEY,storage_name TEXT,bytes INTEGER)",
  );
  try {
    const manual = await createSnapshot({
      databasePath: file,
      mediaDirectory: media,
      backupDirectory: backups,
      reason: "before-preparation-start",
    });
    let last: any;
    for (const day of ["2026-11-19", "2026-11-20", "2026-11-21"])
      last = await createSnapshot({
        databasePath: file,
        mediaDirectory: media,
        backupDirectory: backups,
        reason: "daily",
        scheduleDate: day,
        courseId: "course",
        now: new Date(day + "T02:15:00Z"),
        retention: 2,
      });
    const duplicate = await createSnapshot({
      databasePath: file,
      mediaDirectory: media,
      backupDirectory: backups,
      reason: "daily",
      scheduleDate: "2026-11-21",
      courseId: "course",
      retention: 2,
    });
    assert.equal(duplicate.skipped, true);
    assert.equal(duplicate.backupId, last.backupId);
    assert.equal(
      readdirSync(backups).filter((name) => name.endsWith(".manifest.json"))
        .length,
      3,
    );
    assert.equal(existsSync(manual.manifest), true);
    const id = randomUUID();
    db.prepare("INSERT INTO media VALUES(?,?,?)").run(id, id + ".webp", 5);
    await assert.rejects(
      createSnapshot({
        databasePath: file,
        mediaDirectory: media,
        backupDirectory: backups,
        reason: "daily",
        scheduleDate: "2026-11-22",
        courseId: "course",
        retention: 1,
      }),
      /chýba/,
    );
    assert.equal(existsSync(last.manifest), true);
    assert.equal(
      readdirSync(backups).filter((name) => name.endsWith(".manifest.json"))
        .length,
      3,
    );
    const status = JSON.parse(
      readFileSync(join(backups, "last-status.json"), "utf8"),
    );
    assert.equal(status.lastSuccess.backupId, last.backupId);
    assert.ok(status.lastError);
    assert.equal(
      readdirSync(backups).some((name) => name.startsWith(".incomplete-")),
      false,
    );
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test("restore failure after offline checkpoint preserves all original committed WAL data", async () => {
  const dir = mkdtempSync(join(tmpdir(), "zk-restore-failure-")),
    live = join(dir, "live"),
    backupDir = join(dir, "backups"),
    target = join(live, "app.sqlite"),
    source = join(dir, "source.sqlite");
  mkdirSync(live);
  const old = new DatabaseSync(source);
  old.exec(
    "CREATE TABLE courses(id TEXT PRIMARY KEY);INSERT INTO courses VALUES('backup')",
  );
  old.close();
  try {
    const snapshot = await createSnapshot({
      databasePath: source,
      backupDirectory: backupDir,
    });
    const crash = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        "import {DatabaseSync} from 'node:sqlite';const d=new DatabaseSync(process.env.DATABASE_PATH);d.exec(\"PRAGMA journal_mode=WAL;PRAGMA wal_autocheckpoint=0;CREATE TABLE courses(id TEXT PRIMARY KEY);INSERT INTO courses VALUES('committed-original')\");process.exit(0);",
      ],
      { env: { ...process.env, DATABASE_PATH: target }, encoding: "utf8" },
    );
    assert.equal(crash.status, 0, crash.stderr);
    assert.ok(statSync(target + "-wal").size > 0);
    // A deliberately conflicting isolated media root moves the staged DB away,
    // causing the final DB rename to fail. No system paths or live data are used.
    const failed = spawnSync(
      process.execPath,
      [
        new URL("../scripts/restore.mjs", import.meta.url).pathname,
        snapshot.database,
        "--confirm-stopped",
      ],
      {
        env: { ...process.env, DATABASE_PATH: target, MEDIA_DIRECTORY: live },
        encoding: "utf8",
      },
    );
    assert.notEqual(failed.status, 0);
    const preserved = new DatabaseSync(target);
    assert.equal(
      preserved.prepare("SELECT id FROM courses").get()!.id,
      "committed-original",
    );
    preserved.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test("daily scheduler follows local time, handles repeated DST hours once and yields to external scheduling", async () => {
  assert.equal(
    dueBackupDay(new Date("2026-03-29T01:14:00Z"), "Europe/Bratislava"),
    null,
  );
  assert.equal(
    dueBackupDay(new Date("2026-03-29T01:15:00Z"), "Europe/Bratislava"),
    "2026-03-29",
  );
  let current = new Date("2026-10-25T00:30:00Z");
  const calls: string[] = [];
  const scheduler = startBackupScheduler({
    mode: "internal",
    time: "02:30",
    now: () => current,
    getTimezone: () => "Europe/Bratislava",
    runSnapshot: async (day) => {
      calls.push(day);
    },
    log: () => {},
  });
  try {
    await scheduler.tick();
    current = new Date("2026-10-25T01:30:00Z");
    await scheduler.tick();
    assert.deepEqual(calls, ["2026-10-25"]);
    current = new Date("2026-10-26T01:30:00Z");
    await scheduler.tick();
    assert.deepEqual(calls, ["2026-10-25", "2026-10-26"]);
  } finally {
    await scheduler.stop();
  }
  const directory = mkdtempSync(join(tmpdir(), "zk-external-backup-"));
  try {
    writeFileSync(join(directory, ".external-scheduler"), "host timer");
    assert.equal(
      schedulerMode({ BACKUP_SCHEDULER: "internal" }, directory),
      "external",
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

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
