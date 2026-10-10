import type { Task, TaskInput } from '@/models/types';

import type { Db } from './database';

interface TaskRow {
  id: number;
  title: string;
  description: string | null;
  completed: number;
  due_date_time: string | null;
  created_at: string;
  category_id: number | null;
  notification_id: string | null;
}

function mapRow(row: TaskRow): Task {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    completed: row.completed === 1,
    dueDateTime: row.due_date_time,
    createdAt: row.created_at,
    categoryId: row.category_id,
    notificationId: row.notification_id,
  };
}

/** Throws if the title is empty after trimming. Returns the trimmed title. */
export function validateTitle(title: string): string {
  const trimmed = title.trim();
  if (trimmed.length === 0) {
    throw new Error('Title is required.');
  }
  return trimmed;
}

function normalizeDescription(description: string | null): string | null {
  const trimmed = description?.trim() ?? '';
  return trimmed.length > 0 ? trimmed : null;
}

const SELECT_COLUMNS =
  'id, title, description, completed, due_date_time, created_at, category_id, notification_id';

/**
 * Pending first, then by due date (tasks without a due date last), then newest first.
 */
export async function getAllTasks(db: Db): Promise<Task[]> {
  const rows = await db.getAllAsync<TaskRow>(
    `SELECT ${SELECT_COLUMNS} FROM tasks
     ORDER BY completed ASC,
              due_date_time IS NULL ASC,
              due_date_time ASC,
              created_at DESC,
              id DESC`,
  );
  return rows.map(mapRow);
}

export async function getTaskById(db: Db, id: number): Promise<Task | null> {
  const row = await db.getFirstAsync<TaskRow>(
    `SELECT ${SELECT_COLUMNS} FROM tasks WHERE id = ?`,
    id,
  );
  return row ? mapRow(row) : null;
}

export async function insertTask(
  db: Db,
  input: TaskInput,
  createdAt: string = new Date().toISOString(),
): Promise<Task> {
  const title = validateTitle(input.title);
  const result = await db.runAsync(
    `INSERT INTO tasks (title, description, completed, due_date_time, created_at, category_id)
     VALUES (?, ?, ?, ?, ?, ?)`,
    title,
    normalizeDescription(input.description),
    input.completed ? 1 : 0,
    input.dueDateTime,
    createdAt,
    input.categoryId,
  );
  const created = await getTaskById(db, result.lastInsertRowId);
  if (!created) {
    throw new Error('Task was not found after insert.');
  }
  return created;
}

export async function updateTask(db: Db, id: number, input: TaskInput): Promise<Task> {
  const title = validateTitle(input.title);
  const result = await db.runAsync(
    `UPDATE tasks
     SET title = ?, description = ?, completed = ?, due_date_time = ?, category_id = ?
     WHERE id = ?`,
    title,
    normalizeDescription(input.description),
    input.completed ? 1 : 0,
    input.dueDateTime,
    input.categoryId,
    id,
  );
  if (result.changes === 0) {
    throw new Error(`Task ${id} does not exist.`);
  }
  return (await getTaskById(db, id))!;
}

export async function setTaskCompleted(db: Db, id: number, completed: boolean): Promise<Task> {
  const result = await db.runAsync(
    'UPDATE tasks SET completed = ? WHERE id = ?',
    completed ? 1 : 0,
    id,
  );
  if (result.changes === 0) {
    throw new Error(`Task ${id} does not exist.`);
  }
  return (await getTaskById(db, id))!;
}

export async function setTaskNotificationId(
  db: Db,
  id: number,
  notificationId: string | null,
): Promise<void> {
  await db.runAsync('UPDATE tasks SET notification_id = ? WHERE id = ?', notificationId, id);
}

export async function deleteTask(db: Db, id: number): Promise<void> {
  await db.runAsync('DELETE FROM tasks WHERE id = ?', id);
}
