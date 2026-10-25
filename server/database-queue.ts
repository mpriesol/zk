import type { Database, Statement } from "../lib/database.ts";

// Better Auth holds asynchronous transactions on the same native SQLite
// connection used by the application. No unrelated operation may enter one.
const queues = new WeakMap<object, Promise<unknown>>();
export async function databaseOperation<T>(
  db: object,
  work: () => T | Promise<T>,
): Promise<T> {
  const previous = queues.get(db) || Promise.resolve();
  const next = previous.catch(() => {}).then(work);
  queues.set(db, next);
  try {
    return await next;
  } finally {
    if (queues.get(db) === next) queues.delete(db);
  }
}

/** For background workers: lock each database operation, never network I/O.
 * API handlers already hold the outer lock and must keep using the raw DB.
 */
export function queuedDatabase(db: Database): Database {
  const originals = new WeakMap<Statement, Statement>();
  const wrap = (statement: Statement): Statement => {
    const wrapped: Statement = {
      bind(...values: unknown[]) {
        return wrap(statement.bind(...values));
      },
      first<T = Record<string, unknown>>() {
        return databaseOperation(db, () => statement.first<T>());
      },
      all<T = Record<string, unknown>>() {
        return databaseOperation(db, () => statement.all<T>());
      },
      run() {
        return databaseOperation(db, () => statement.run());
      },
    };
    originals.set(wrapped, statement);
    return wrapped;
  };
  return {
    prepare(sql: string) {
      return wrap(db.prepare(sql));
    },
    batch<T = unknown>(statements: Statement[]): Promise<T[]> {
      const underlying = statements.map((statement) => {
        const original = originals.get(statement);
        if (!original) throw new TypeError("Nekompatibilný SQL príkaz.");
        return original;
      });
      return databaseOperation(db, () => db.batch<T>(underlying));
    },
  };
}
