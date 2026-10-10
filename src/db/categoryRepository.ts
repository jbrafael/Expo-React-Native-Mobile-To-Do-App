import type { Category } from '@/models/types';

import type { Db } from './database';

export class DuplicateCategoryError extends Error {
  constructor(name: string) {
    super(`A category named "${name}" already exists.`);
    this.name = 'DuplicateCategoryError';
  }
}

/** Throws if the name is empty after trimming. Returns the trimmed name. */
export function validateCategoryName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    throw new Error('Category name is required.');
  }
  return trimmed;
}

/**
 * Names are unique case-insensitively (`UNIQUE COLLATE NOCASE` in the schema). We check first to
 * give a friendly error; the constraint still protects against races.
 */
async function assertNameAvailable(db: Db, name: string, exceptId?: number): Promise<void> {
  const existing = await db.getFirstAsync<{ id: number }>(
    'SELECT id FROM categories WHERE name = ? COLLATE NOCASE AND id IS NOT ?',
    name,
    exceptId ?? null,
  );
  if (existing) {
    throw new DuplicateCategoryError(name);
  }
}

export async function getAllCategories(db: Db): Promise<Category[]> {
  return db.getAllAsync<Category>('SELECT id, name FROM categories ORDER BY name COLLATE NOCASE');
}

export async function insertCategory(db: Db, rawName: string): Promise<Category> {
  const name = validateCategoryName(rawName);
  await assertNameAvailable(db, name);
  const result = await db.runAsync('INSERT INTO categories (name) VALUES (?)', name);
  return { id: result.lastInsertRowId, name };
}

export async function renameCategory(db: Db, id: number, rawName: string): Promise<Category> {
  const name = validateCategoryName(rawName);
  await assertNameAvailable(db, name, id);
  const result = await db.runAsync('UPDATE categories SET name = ? WHERE id = ?', name, id);
  if (result.changes === 0) {
    throw new Error(`Category ${id} does not exist.`);
  }
  return { id, name };
}

export async function countTasksInCategory(db: Db, id: number): Promise<number> {
  const row = await db.getFirstAsync<{ count: number }>(
    'SELECT COUNT(*) AS count FROM tasks WHERE category_id = ?',
    id,
  );
  return row?.count ?? 0;
}

/**
 * Deletes a category while keeping its tasks: they become uncategorised.
 * Both statements run in one transaction so a failure cannot leave tasks pointing at a deleted
 * category (the `ON DELETE SET NULL` foreign key is a second line of defence).
 */
export async function deleteCategory(db: Db, id: number): Promise<void> {
  await db.withTransactionAsync(async () => {
    await db.runAsync('UPDATE tasks SET category_id = NULL WHERE category_id = ?', id);
    await db.runAsync('DELETE FROM categories WHERE id = ?', id);
  });
}
