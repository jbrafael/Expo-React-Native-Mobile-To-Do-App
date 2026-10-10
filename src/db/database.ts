import type { SQLiteDatabase } from 'expo-sqlite';

export const DATABASE_NAME = 'taskflow.db';

/**
 * The subset of the expo-sqlite `SQLiteDatabase` API that repositories use.
 * Typing repositories against this interface (instead of the full class) lets unit tests
 * run the real SQL against an in-memory SQLite engine in Node.
 */
export type Db = Pick<
  SQLiteDatabase,
  'execAsync' | 'runAsync' | 'getAllAsync' | 'getFirstAsync' | 'withTransactionAsync'
>;

/**
 * Ordered schema migrations. Index `i` upgrades the database from `user_version = i` to `i + 1`.
 * Never edit a migration that has shipped — append a new one instead.
 */
const MIGRATIONS: string[] = [
  // v1: initial schema
  `
  CREATE TABLE IF NOT EXISTS categories (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT    NOT NULL UNIQUE COLLATE NOCASE CHECK (length(trim(name)) > 0)
  );

  CREATE TABLE IF NOT EXISTS tasks (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    title           TEXT    NOT NULL CHECK (length(trim(title)) > 0),
    description     TEXT,
    completed       INTEGER NOT NULL DEFAULT 0 CHECK (completed IN (0, 1)),
    due_date_time   TEXT,
    created_at      TEXT    NOT NULL,
    category_id     INTEGER REFERENCES categories(id) ON DELETE SET NULL,
    notification_id TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_tasks_category_id ON tasks(category_id);
  CREATE INDEX IF NOT EXISTS idx_tasks_completed ON tasks(completed);
  `,
];

export const SCHEMA_VERSION = MIGRATIONS.length;

/**
 * Called by `<SQLiteProvider onInit>` before any screen renders, and by tests.
 * Applies pending migrations based on `PRAGMA user_version`.
 */
export async function migrateDbIfNeeded(db: Db): Promise<void> {
  // WAL improves concurrent read/write behaviour; foreign_keys is per-connection and off by default.
  await db.execAsync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  let version = row?.user_version ?? 0;

  while (version < MIGRATIONS.length) {
    const next = version + 1;
    await db.withTransactionAsync(async () => {
      await db.execAsync(MIGRATIONS[version]);
      // PRAGMA does not accept bound parameters; `next` is a trusted integer.
      await db.execAsync(`PRAGMA user_version = ${next}`);
    });
    version = next;
  }
}
