import { DatabaseSync, backup } from "node:sqlite";
import { chmodSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";

process.umask(0o077);
const source = resolve(process.env.DATABASE_PATH || "/data/cestou-zimy.sqlite");
const output = resolve(
  process.argv[2] ||
    `${dirname(source)}/backups/cestou-zimy-${new Date().toISOString().replaceAll(":", "-")}.sqlite`,
);
if (source === output || existsSync(output))
  throw new Error(
    "Cieľ zálohy už existuje alebo sa zhoduje s databázou. Nič nebolo prepísané.",
  );
if (!existsSync(source)) throw new Error("Databáza neexistuje.");
mkdirSync(dirname(output), { recursive: true, mode: 0o700 });
const db = new DatabaseSync(source, { readOnly: true, timeout: 10000 });
try {
  await backup(db, output);
  const check = new DatabaseSync(output, { readOnly: true });
  try {
    if (check.prepare("PRAGMA integrity_check").get().integrity_check !== "ok")
      throw new Error("Kontrola integrity zálohy zlyhala.");
  } finally {
    check.close();
  }
  chmodSync(output, 0o600);
  console.log(`Overená SQLite záloha: ${output}`);
} catch (error) {
  rmSync(output, { force: true });
  throw error;
} finally {
  db.close();
}
