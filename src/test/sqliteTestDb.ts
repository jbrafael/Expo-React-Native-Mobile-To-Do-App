/**
 * Test-only adapter: exposes the expo-sqlite async API subset used by the repositories (`Db`)
 * on top of better-sqlite3, so unit tests execute the real SQL against a real SQLite engine.
 */
import Database from 'better-sqlite3';

import type { Db } from '@/db/database';

type Params = unknown[];

function flatten(params: Params): unknown[] {
  // expo-sqlite accepts both `run(sql, a, b)` and `run(sql, [a, b])`.
  return params.length === 1 && Array.isArray(params[0]) ? (params[0] as unknown[]) : params;
}

/**
 * better-sqlite3's native addon registers its `SqliteError` class once per *process*, but Jest
 * gives each test file a fresh JS realm. When another test file in the same worker loaded the
 * addon first, thrown errors fail `instanceof Error` in this realm and `rejects.toThrow()` reports
 * "did not throw". Re-wrapping keeps errors realm-local (see BUILD_LOG.md, Entry 6).
 */
function call<T>(fn: () => T): T {
  try {
    return fn();
  } catch (error) {
    const e = error as { message?: unknown; code?: unknown };
    const wrapped = new Error(String(e?.message ?? error));
    (wrapped as Error & { code?: unknown }).code = e?.code;
    throw wrapped;
  }
}

export function createTestDb(): Db & { raw: Database.Database; close: () => void } {
  const raw = new Database(':memory:');
  const db = {
    raw,
    close: () => raw.close(),
    async execAsync(sql: string) {
      call(() => raw.exec(sql));
    },
    async runAsync(sql: string, ...params: Params) {
      const info = call(() => raw.prepare(sql).run(...flatten(params)));
      return { lastInsertRowId: Number(info.lastInsertRowid), changes: info.changes };
    },
    async getAllAsync(sql: string, ...params: Params) {
      return call(() => raw.prepare(sql).all(...flatten(params)));
    },
    async getFirstAsync(sql: string, ...params: Params) {
      return call(() => raw.prepare(sql).get(...flatten(params))) ?? null;
    },
    async withTransactionAsync(task: () => Promise<void>) {
      raw.exec('BEGIN');
      try {
        await task();
        raw.exec('COMMIT');
      } catch (error) {
        raw.exec('ROLLBACK');
        throw error;
      }
    },
  };
  return db as unknown as Db & { raw: Database.Database; close: () => void };
}
