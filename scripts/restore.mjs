import { DatabaseSync, backup } from "node:sqlite";
import { createReadStream } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import {
  chmod,
  copyFile,
  mkdir,
  readFile,
  rename,
  rm,
  stat,
} from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { createSnapshot, snapshotPaths } from "./backup.mjs";

process.umask(0o077);
const inputArg = process.argv[2];
if (!inputArg || !process.argv.includes("--confirm-stopped")) {
  console.error(
    "Najprv zastav aplikáciu. Použitie: node scripts/restore.mjs ZALOHA.sqlite --confirm-stopped",
  );
  process.exit(1);
}
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
const input = resolve(inputArg),
  target = resolve(process.env.DATABASE_PATH || "/data/cestou-zimy.sqlite"),
  targetMedia = resolve(
    process.env.MEDIA_DIRECTORY || resolve(dirname(target), "media"),
  );
if (input === target || !(await exists(input)))
  throw new Error("Neplatná cesta zálohy.");
const paths = snapshotPaths(input),
  suffix = randomUUID(),
  staged = `${target}.restore-${suffix}`,
  stagedMedia = `${targetMedia}.restore-${suffix}`,
  oldMedia = `${targetMedia}.previous-${suffix}`;
await mkdir(dirname(target), { recursive: true, mode: 0o700 });
await mkdir(dirname(targetMedia), { recursive: true, mode: 0o700 });
let previousSnapshot,
  mediaMoved = false,
  mediaPromoted = false,
  databasePromoted = false;
const source = new DatabaseSync(input, { readOnly: true, timeout: 10000 });
try {
  if (source.prepare("PRAGMA integrity_check").get().integrity_check !== "ok")
    throw new Error("Záloha neprešla kontrolou integrity.");
  if (
    !source
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='courses'",
      )
      .get()
  )
    throw new Error("Toto nie je databáza Cestou Zimy.");
  const refs = source
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='media'",
    )
    .get()
    ? source.prepare("SELECT id,storage_name,bytes FROM media").all()
    : [];
  let manifest = null;
  if (await exists(paths.manifest)) {
    manifest = JSON.parse(await readFile(paths.manifest, "utf8"));
    if (
      manifest.version !== 1 ||
      manifest.database !== basename(input) ||
      manifest.databaseSha256 !== (await hashFile(input)) ||
      !Array.isArray(manifest.media)
    )
      throw new Error("Manifest alebo kontrolný súčet databázy nesedí.");
  } else if (refs.length)
    throw new Error(
      "Záloha má odkazy na fotografie, ale nemá manifest a overené súbory. Obnova bola zastavená.",
    );
  await mkdir(stagedMedia, { mode: 0o700 });
  for (const reference of refs) {
    const name = String(reference.storage_name);
    if (!/^[a-f0-9-]{36}\.webp$/.test(name))
      throw new Error("Neplatná cesta fotografie v zálohe.");
    const record = manifest.media.find(
      (entry) => entry.id === reference.id && entry.storageName === name,
    );
    const from = resolve(paths.assets, name),
      to = resolve(stagedMedia, name);
    if (
      !record ||
      !(await exists(from)) ||
      (await stat(from)).size !== Number(reference.bytes) ||
      (await hashFile(from)) !== record.sha256
    )
      throw new Error(
        "Fotografia chýba alebo neprešla kontrolou. Aktuálny stav nebol zmenený.",
      );
    await copyFile(from, to);
    await chmod(to, 0o600);
  }
  await backup(source, staged);
  await chmod(staged, 0o600);
  if (await exists(target)) {
    const savedBefore = `${target}.before-restore-${new Date().toISOString().replaceAll(":", "-")}.sqlite`;
    previousSnapshot = await createSnapshot({
      databasePath: target,
      mediaDirectory: targetMedia,
      outputPath: savedBefore,
      reason: "before-restore",
    });
    // Preserve committed WAL data in the original main file before any rename.
    // If a later filesystem operation fails, restoring the original media path
    // leaves a complete original database, not an older main file without WAL.
    const current = new DatabaseSync(target, { timeout: 10000 });
    try {
      const checkpoint = current
        .prepare("PRAGMA wal_checkpoint(TRUNCATE)")
        .get();
      if (Number(checkpoint.busy) !== 0)
        throw new Error(
          "Databázu stále používa iný proces. Zastav aplikáciu a zopakuj obnovu.",
        );
    } finally {
      current.close();
    }
  }
  await rm(`${target}-wal`, { force: true });
  await rm(`${target}-shm`, { force: true });
  if (await exists(targetMedia)) {
    await rename(targetMedia, oldMedia);
    mediaMoved = true;
  }
  await rename(stagedMedia, targetMedia);
  mediaPromoted = true;
  await rename(staged, target);
  databasePromoted = true;
  await rm(oldMedia, { recursive: true, force: true });
  console.log(`Databáza a fotografie obnovené: ${target}`);
  if (previousSnapshot)
    console.log(`Predchádzajúci stav zachovaný: ${previousSnapshot.manifest}`);
} finally {
  source.close();
  if (!databasePromoted) {
    if (mediaPromoted) await rm(targetMedia, { recursive: true, force: true });
    if (mediaMoved) await rename(oldMedia, targetMedia);
  }
  await rm(staged, { force: true });
  await rm(stagedMedia, { recursive: true, force: true });
}
