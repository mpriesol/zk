import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import {
  mkdirSync,
  chmodSync,
  existsSync,
  readFileSync,
  readdirSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createHash } from "node:crypto";
import type { Database, Statement } from "../lib/database.ts";

class SQLiteStatement implements Statement {
  private db: DatabaseSync;
  private sql: string;
  private values: unknown[];
  constructor(db: DatabaseSync, sql: string, values: unknown[] = []) {
    this.db = db;
    this.sql = sql;
    this.values = values;
  }
  bind(...values: unknown[]): SQLiteStatement {
    return new SQLiteStatement(this.db, this.sql, values);
  }
  execute() {
    return this.db.prepare(this.sql).run(...(this.values as SQLInputValue[]));
  }
  async run() {
    const result = this.execute();
    return {
      meta: {
        changes: Number(result.changes),
        last_row_id: Number(result.lastInsertRowid),
      },
    };
  }
  async first<T = Record<string, unknown>>(): Promise<T | null> {
    return (
      (this.db.prepare(this.sql).get(...(this.values as SQLInputValue[])) as
        | T
        | undefined) ?? null
    );
  }
  async all<T = Record<string, unknown>>(): Promise<{ results: T[] }> {
    return {
      results: this.db
        .prepare(this.sql)
        .all(...(this.values as SQLInputValue[])) as T[],
    };
  }
}
export class SQLiteDatabase implements Database {
  readonly native: DatabaseSync;
  constructor(path = ":memory:") {
    if (path !== ":memory:")
      mkdirSync(dirname(resolve(path)), { recursive: true, mode: 0o700 });
    this.native = new DatabaseSync(path);
    this.native.exec(
      "PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;",
    );
    if (path !== ":memory:") chmodSync(path, 0o600);
  }
  prepare(sql: string): Statement {
    return new SQLiteStatement(this.native, sql);
  }
  async batch<T = unknown>(statements: Statement[]): Promise<T[]> {
    this.native.exec("BEGIN IMMEDIATE");
    try {
      const results = statements.map((s) => {
        if (!(s instanceof SQLiteStatement))
          throw new TypeError("Nekompatibilný SQL príkaz.");
        const r = s.execute();
        return { meta: { changes: Number(r.changes) } } as T;
      });
      this.native.exec("COMMIT");
      return results;
    } catch (error) {
      this.native.exec("ROLLBACK");
      throw error;
    }
  }
  close() {
    this.native.close();
  }
}

/** Schema migrations are atomic and checksum-locked. Existing migrations are immutable. */
export function migrateApp(
  db: SQLiteDatabase,
  directory = resolve("drizzle"),
): string[] {
  db.native.exec(
    "CREATE TABLE IF NOT EXISTS __app_migrations (name TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at TEXT NOT NULL)",
  );
  const applied: string[] = [];
  if (!existsSync(directory))
    throw new Error(`Chýba adresár migrácií: ${directory}`);
  for (const name of readdirSync(directory)
    .filter((name) => name.endsWith(".sql"))
    .sort()) {
    const sql = readFileSync(join(directory, name), "utf8"),
      checksum = createHash("sha256").update(sql).digest("hex");
    const previous = db.native
      .prepare("SELECT checksum FROM __app_migrations WHERE name=?")
      .get(name);
    if (previous) {
      if (previous.checksum !== checksum)
        throw new Error(`Už aplikovaná migrácia bola zmenená: ${name}`);
      continue;
    }
    db.native.exec("BEGIN IMMEDIATE");
    try {
      db.native.exec(sql);
      db.native
        .prepare(
          "INSERT INTO __app_migrations(name,checksum,applied_at) VALUES(?,?,?)",
        )
        .run(name, checksum, new Date().toISOString());
      db.native.exec("COMMIT");
      applied.push(name);
    } catch (error) {
      db.native.exec("ROLLBACK");
      throw error;
    }
  }
  return applied;
}
