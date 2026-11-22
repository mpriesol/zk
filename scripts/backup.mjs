import { DatabaseSync, backup } from "node:sqlite";
import { createReadStream } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import {
  chmod,
  copyFile,
  mkdir,
  readFile,
  readdir,
  readlink,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { hostname } from "node:os";
import { pathToFileURL } from "node:url";

const exists = async (path) => {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
};
const hashFile = async (path) => {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
};
const mediaName = (value) =>
  typeof value === "string" && /^[a-f0-9-]{36}\.webp$/.test(value);
const hasMedia = (db) =>
  !!db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='media'",
    )
    .get();
export const snapshotPaths = (databasePath) => ({
  database: resolve(databasePath),
  assets: resolve(databasePath) + ".assets",
  manifest: resolve(databasePath) + ".manifest.json",
});
async function atomicJson(path, data) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(data, null, 2) + "\n", {
    mode: 0o600,
    flag: "wx",
  });
  await rename(temporary, path);
}
async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return null;
  }
}
async function processNamespace() {
  try {
    return await readlink("/proc/self/ns/pid");
  } catch {
    return "unknown";
  }
}
async function acquireBackupLock(directory) {
  const path = resolve(directory, ".backup-lock");
  const owner = {
    id: randomUUID(),
    pid: process.pid,
    host: hostname(),
    namespace: await processNamespace(),
    at: new Date().toISOString(),
  };
  try {
    await mkdir(path, { mode: 0o700 });
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    const previous = await readJson(resolve(path, "owner.json"));
    let stale = false;
    if (
      previous?.host === owner.host &&
      previous?.namespace === owner.namespace &&
      Number.isInteger(previous?.pid)
    ) {
      try {
        process.kill(previous.pid, 0);
      } catch (failure) {
        stale = failure.code === "ESRCH";
      }
    }
    if (!previous) stale = Date.now() - (await stat(path)).mtimeMs > 60_000;
    else if (
      Date.now() - new Date(previous.heartbeatAt || previous.at).getTime() >
      5 * 60_000
    )
      stale = true;
    if (!stale)
      throw new Error("Iná záloha práve beží. Ďalší beh sa neotvoril.");
    await rm(path, { recursive: true, force: true });
    await mkdir(path, { mode: 0o700 });
  }
  await atomicJson(resolve(path, "owner.json"), owner);
  let heartbeatWork = Promise.resolve();
  const heartbeat = setInterval(() => {
    heartbeatWork = heartbeatWork
      .then(() =>
        atomicJson(resolve(path, "owner.json"), {
          ...owner,
          heartbeatAt: new Date().toISOString(),
        }),
      )
      .catch(() => {});
  }, 30_000);
  heartbeat.unref();
  return async () => {
    clearInterval(heartbeat);
    await heartbeatWork;
    const current = await readJson(resolve(path, "owner.json"));
    if (current?.id === owner.id)
      await rm(path, { recursive: true, force: true });
  };
}
async function completedSnapshots(directory) {
  const result = [];
  for (const name of await readdir(directory)) {
    if (!name.endsWith(".manifest.json")) continue;
    const manifestPath = resolve(directory, name),
      manifest = await readJson(manifestPath);
    if (
      manifest?.version !== 1 ||
      typeof manifest.database !== "string" ||
      basename(manifest.database) !== manifest.database ||
      name !== manifest.database + ".manifest.json"
    )
      continue;
    const paths = snapshotPaths(resolve(directory, manifest.database));
    if (!(await exists(paths.database)) || !(await exists(paths.assets)))
      continue;
    result.push({ manifest, paths });
  }
  return result;
}
async function pruneSnapshots(directory, keep) {
  const daily = (await completedSnapshots(directory))
    .filter((item) => item.manifest.reason === "daily")
    .sort((a, b) => b.manifest.createdAt.localeCompare(a.manifest.createdAt));
  for (const item of daily.slice(keep)) {
    await rm(item.paths.manifest, { force: true });
    await rm(item.paths.database, { force: true });
    await rm(item.paths.assets, { recursive: true, force: true });
  }
}
/** A finalized manifest is the success marker. Immutable assets are copied from
 * the consistent SQLite snapshot. Scheduled callers hold the app DB queue. */
export async function createSnapshot(options) {
  process.umask(0o077);
  const source = resolve(options.databasePath);
  const mediaDirectory = resolve(
    options.mediaDirectory || resolve(dirname(source), "media"),
  );
  const directory = resolve(options.backupDirectory || "/backups");
  const now = options.now || new Date(),
    createdAt = now.toISOString();
  const reason = options.reason || "manual";
  const retention = Number(options.retention ?? 30);
  if (!Number.isInteger(retention) || retention < 1 || retention > 3650)
    throw new Error("Retencia musí byť celé číslo od 1 do 3650.");
  const output = resolve(
    options.outputPath ||
      resolve(
        directory,
        `cestou-zimy-${createdAt.replaceAll(":", "-")}-${randomUUID().slice(0, 8)}.sqlite`,
      ),
  );
  const root = dirname(output),
    paths = snapshotPaths(output),
    statusPath = resolve(root, "last-status.json");
  if (source === output || !(await exists(source)))
    throw new Error("Neplatný zdroj alebo cieľ zálohy.");
  await mkdir(root, { recursive: true, mode: 0o700 });
  const release = await acquireBackupLock(root);
  const staging = resolve(root, `.incomplete-${randomUUID()}`);
  let committedDatabase = false,
    committedAssets = false,
    committedManifest = false;
  try {
    if (reason === "daily" && options.scheduleDate) {
      const previous = (await completedSnapshots(root)).find(
        (item) =>
          item.manifest.reason === "daily" &&
          item.manifest.scheduleDate === options.scheduleDate &&
          item.manifest.courseId === (options.courseId || null),
      );
      if (previous)
        return {
          backupId: previous.manifest.id,
          ...previous.paths,
          skipped: true,
        };
    }
    if (
      (await exists(paths.database)) ||
      (await exists(paths.assets)) ||
      (await exists(paths.manifest))
    )
      throw new Error("Cieľ zálohy už existuje. Nič nebolo prepísané.");
    await mkdir(staging, { mode: 0o700 });
    const temporaryDb = resolve(staging, "database.sqlite"),
      temporaryAssets = resolve(staging, "assets"),
      temporaryManifest = resolve(staging, "manifest.json");
    await mkdir(temporaryAssets, { mode: 0o700 });
    const sourceDb = new DatabaseSync(source, {
      readOnly: true,
      timeout: 10000,
    });
    try {
      await backup(sourceDb, temporaryDb);
    } finally {
      sourceDb.close();
    }
    await chmod(temporaryDb, 0o600);
    const check = new DatabaseSync(temporaryDb, { readOnly: true });
    let references;
    try {
      if (
        check.prepare("PRAGMA integrity_check").get().integrity_check !== "ok"
      )
        throw new Error("Kontrola integrity zálohy zlyhala.");
      references = hasMedia(check)
        ? check
            .prepare("SELECT id,storage_name,bytes FROM media ORDER BY id")
            .all()
        : [];
    } finally {
      check.close();
    }
    const media = [];
    for (const row of references) {
      if (!mediaName(row.storage_name))
        throw new Error("Databáza obsahuje neplatnú cestu fotografie.");
      const from = resolve(mediaDirectory, row.storage_name),
        to = resolve(temporaryAssets, row.storage_name);
      try {
        await copyFile(from, to);
      } catch {
        throw new Error(
          "Fotografia zo snapshotu chýba. Záloha nebola dokončená; zopakuj ju po skončení úprav.",
        );
      }
      const metadata = await stat(to);
      if (metadata.size !== Number(row.bytes))
        throw new Error(
          "Veľkosť fotografie sa nezhoduje s databázou. Záloha nebola dokončená.",
        );
      await chmod(to, 0o600);
      media.push({
        id: row.id,
        storageName: row.storage_name,
        bytes: metadata.size,
        sha256: await hashFile(to),
      });
    }
    const manifest = {
      version: 1,
      id: basename(output),
      database: basename(output),
      createdAt,
      reason,
      courseId: options.courseId || null,
      scheduleDate: options.scheduleDate || null,
      timezone: options.timezone || null,
      databaseSha256: await hashFile(temporaryDb),
      media,
    };
    await writeFile(
      temporaryManifest,
      JSON.stringify(manifest, null, 2) + "\n",
      { mode: 0o600, flag: "wx" },
    );
    await rename(temporaryDb, paths.database);
    committedDatabase = true;
    await rename(temporaryAssets, paths.assets);
    committedAssets = true;
    await rename(temporaryManifest, paths.manifest);
    committedManifest = true;
    const status = (await readJson(statusPath)) || {};
    await atomicJson(statusPath, {
      ...status,
      lastAttempt: createdAt,
      lastError: null,
      lastSuccess: {
        at: createdAt,
        backupId: manifest.id,
        manifest: paths.manifest,
        mediaCount: media.length,
        reason,
      },
    });
    await pruneSnapshots(root, retention);
    return {
      backupId: manifest.id,
      ...paths,
      mediaCount: media.length,
      skipped: false,
    };
  } catch (error) {
    if (!committedManifest) {
      if (committedDatabase) await rm(paths.database, { force: true });
      if (committedAssets)
        await rm(paths.assets, { recursive: true, force: true });
    }
    const previous = (await readJson(statusPath)) || {};
    await atomicJson(statusPath, {
      ...previous,
      lastAttempt: createdAt,
      lastError: {
        at: createdAt,
        message: error instanceof Error ? error.message : "Záloha zlyhala.",
      },
    }).catch(() => {});
    throw error;
  } finally {
    await rm(staging, { recursive: true, force: true });
    await release();
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const source = resolve(
    process.env.DATABASE_PATH || "/data/cestou-zimy.sqlite",
  );
  const output = process.argv
    .slice(2)
    .find((argument) => !argument.startsWith("--"));
  const timeZone = process.env.BACKUP_TIMEZONE || "Europe/Bratislava";
  const day = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const result = await createSnapshot({
    databasePath: source,
    mediaDirectory: process.env.MEDIA_DIRECTORY,
    backupDirectory: process.env.BACKUP_DIRECTORY || "/backups",
    outputPath: output,
    reason: process.argv.includes("--daily") ? "daily" : "manual",
    scheduleDate: process.argv.includes("--daily") ? day : undefined,
    timezone: timeZone,
    courseId: process.env.COURSE_ID || "cestou-zimy",
    retention: Number(process.env.BACKUP_RETENTION || 30),
  });
  console.log(
    `${result.skipped ? "Denná záloha už existuje" : "Overená záloha databázy a fotografií"}: ${result.manifest}`,
  );
}
