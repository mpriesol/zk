import { DatabaseSync, backup } from "node:sqlite";
import { chmodSync, existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";

process.umask(0o077);
const inputArg = process.argv[2];
if (!inputArg || !process.argv.includes("--confirm-stopped")) {
  console.error(
    "Najprv zastav aplikáciu. Použitie: node scripts/restore.mjs ZALOHA --confirm-stopped",
  );
  process.exit(1);
}
const input = resolve(inputArg);
const target = resolve(process.env.DATABASE_PATH || "/data/cestou-zimy.sqlite");
if (input === target || !existsSync(input))
  throw new Error("Neplatná cesta zálohy.");
mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
const staged = `${target}.restore-${process.pid}`;
if (existsSync(staged)) throw new Error("Dočasný súbor už existuje.");
const savedBefore = `${target}.before-restore-${new Date().toISOString().replaceAll(":", "-")}`;
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
  await backup(source, staged);
  chmodSync(staged, 0o600);
  if (existsSync(target)) {
    const old = new DatabaseSync(target, { readOnly: true, timeout: 10000 });
    try {
      await backup(old, savedBefore);
      chmodSync(savedBefore, 0o600);
    } finally {
      old.close();
    }
  }
  // Safe only with the application stopped: no process may retain the old WAL.
  rmSync(`${target}-wal`, { force: true });
  rmSync(`${target}-shm`, { force: true });
  renameSync(staged, target);
  console.log(`Databáza obnovená: ${target}`);
  if (existsSync(savedBefore))
    console.log(`Predchádzajúci stav zachovaný: ${savedBefore}`);
} finally {
  source.close();
  rmSync(staged, { force: true });
}
