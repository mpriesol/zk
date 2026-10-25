export interface Statement {
  bind(...args: unknown[]): Statement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  run(): Promise<unknown>;
}
export interface Database {
  prepare(sql: string): Statement;
  batch<T = unknown>(statements: Statement[]): Promise<T[]>;
}
export async function rows<T = any>(
  db: Database,
  sql: string,
  ...params: unknown[]
): Promise<T[]> {
  return (
    await db
      .prepare(sql)
      .bind(...params)
      .all<T>()
  ).results;
}
export async function one<T = any>(
  db: Database,
  sql: string,
  ...params: unknown[]
): Promise<T | null> {
  return db
    .prepare(sql)
    .bind(...params)
    .first<T>();
}
export async function run(db: Database, sql: string, ...params: unknown[]) {
  return db
    .prepare(sql)
    .bind(...params)
    .run();
}
export const uid = () => crypto.randomUUID();
