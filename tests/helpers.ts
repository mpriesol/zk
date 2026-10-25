import { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Database, Statement } from "../lib/database.ts";

/** A real isolated SQLite database, with the D1 subset used by the application. */
export class TestDatabase implements Database {
  sqlite: DatabaseSync;
  constructor() {
    this.sqlite = new DatabaseSync(":memory:");
    const migrations = fileURLToPath(new URL("../drizzle/", import.meta.url));
    const files = readdirSync(migrations)
      .filter((name) => name.endsWith(".sql"))
      .sort();
    if (!files.length)
      throw new Error("No SQL migrations generated; run npm run db:generate.");
    for (const file of files)
      this.sqlite.exec(readFileSync(`${migrations}/${file}`, "utf8"));
  }
  prepare(sql: string): Statement {
    return new TestStatement(this.sqlite, sql);
  }
  async batch<T = unknown>(statements: Statement[]): Promise<T[]> {
    this.sqlite.exec("BEGIN");
    try {
      const results: T[] = [];
      // D1 batches are atomic; run synchronously here so another request cannot
      // interleave inside SQLite's single connection transaction.
      for (const statement of statements)
        results.push((statement as TestStatement).runSync() as T);
      this.sqlite.exec("COMMIT");
      return results;
    } catch (error) {
      this.sqlite.exec("ROLLBACK");
      throw error;
    }
  }
  close() {
    this.sqlite.close();
  }
  count(table: string, where = "1=1", ...params: any[]): number {
    if (!/^[a-z_]+$/.test(table)) throw new Error("Invalid test table");
    return Number(
      (
        this.sqlite
          .prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE ${where}`)
          .get(...params) as { count: number }
      ).count,
    );
  }
}
class TestStatement implements Statement {
  sqlite: DatabaseSync;
  sql: string;
  parameters: any[];
  constructor(sqlite: DatabaseSync, sql: string, parameters: any[] = []) {
    this.sqlite = sqlite;
    this.sql = sql;
    this.parameters = parameters;
  }
  bind(...parameters: unknown[]): Statement {
    return new TestStatement(this.sqlite, this.sql, parameters);
  }
  async first<T = Record<string, unknown>>(): Promise<T | null> {
    return (this.sqlite.prepare(this.sql).get(...this.parameters) as T) ?? null;
  }
  async all<T = Record<string, unknown>>(): Promise<{ results: T[] }> {
    return {
      results: this.sqlite.prepare(this.sql).all(...this.parameters) as T[],
    };
  }
  runSync(): unknown {
    const result = this.sqlite.prepare(this.sql).run(...this.parameters);
    return {
      success: true,
      meta: {
        changes: Number(result.changes),
        last_row_id: Number(result.lastInsertRowid),
      },
      results: [],
    };
  }
  async run(): Promise<unknown> {
    return this.runSync();
  }
}
