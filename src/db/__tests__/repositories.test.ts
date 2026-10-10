/**
 * @jest-environment node
 */
import * as categoryRepo from '@/db/categoryRepository';
import { migrateDbIfNeeded, SCHEMA_VERSION } from '@/db/database';
import * as taskRepo from '@/db/taskRepository';
import type { TaskInput } from '@/models/types';
import { createTestDb } from '@/test/sqliteTestDb';

const base: TaskInput = {
  title: 'Write report',
  description: null,
  completed: false,
  dueDateTime: null,
  categoryId: null,
};

let db: ReturnType<typeof createTestDb>;

beforeEach(async () => {
  db = createTestDb();
  await migrateDbIfNeeded(db);
});

afterEach(() => db.close());

describe('migrations', () => {
  it('creates the schema and records user_version', async () => {
    const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
    expect(row?.user_version).toBe(SCHEMA_VERSION);
    const tables = await db.getAllAsync<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('tasks', 'categories') ORDER BY name",
    );
    expect(tables.map((t) => t.name)).toEqual(['categories', 'tasks']);
  });

  it('is idempotent', async () => {
    await taskRepo.insertTask(db, base);
    await migrateDbIfNeeded(db);
    expect(await taskRepo.getAllTasks(db)).toHaveLength(1);
  });
});

describe('taskRepository', () => {
  it('inserts and reads a task with all fields', async () => {
    const category = await categoryRepo.insertCategory(db, 'Work');
    const created = await taskRepo.insertTask(
      db,
      {
        title: '  Submit assignment  ',
        description: '  Upload to portal ',
        completed: false,
        dueDateTime: '2030-01-02T03:04:00.000Z',
        categoryId: category.id,
      },
      '2026-10-10T12:00:00.000Z',
    );
    expect(created).toEqual({
      id: expect.any(Number),
      title: 'Submit assignment',
      description: 'Upload to portal',
      completed: false,
      dueDateTime: '2030-01-02T03:04:00.000Z',
      createdAt: '2026-10-10T12:00:00.000Z',
      categoryId: category.id,
      notificationId: null,
    });
    expect(await taskRepo.getTaskById(db, created.id)).toEqual(created);
  });

  it('rejects empty or whitespace-only titles', async () => {
    await expect(taskRepo.insertTask(db, { ...base, title: '   ' })).rejects.toThrow('Title is required.');
    const created = await taskRepo.insertTask(db, base);
    await expect(taskRepo.updateTask(db, created.id, { ...base, title: '' })).rejects.toThrow(
      'Title is required.',
    );
  });

  it('enforces the title CHECK constraint at the SQL level too', async () => {
    await expect(
      db.runAsync("INSERT INTO tasks (title, created_at) VALUES ('  ', '2026-01-01')"),
    ).rejects.toThrow(/CHECK constraint failed/);
  });

  it('updates, completes, reopens and deletes', async () => {
    const created = await taskRepo.insertTask(db, base);
    const updated = await taskRepo.updateTask(db, created.id, {
      ...base,
      title: 'Write final report',
      description: '',
      dueDateTime: '2031-05-05T10:00:00.000Z',
    });
    expect(updated.title).toBe('Write final report');
    expect(updated.description).toBeNull();
    expect(updated.dueDateTime).toBe('2031-05-05T10:00:00.000Z');

    expect((await taskRepo.setTaskCompleted(db, created.id, true)).completed).toBe(true);
    expect((await taskRepo.setTaskCompleted(db, created.id, false)).completed).toBe(false);

    await taskRepo.setTaskNotificationId(db, created.id, 'task-1');
    expect((await taskRepo.getTaskById(db, created.id))?.notificationId).toBe('task-1');

    await taskRepo.deleteTask(db, created.id);
    expect(await taskRepo.getTaskById(db, created.id)).toBeNull();
  });

  it('throws when updating a missing task', async () => {
    await expect(taskRepo.updateTask(db, 999, base)).rejects.toThrow('does not exist');
    await expect(taskRepo.setTaskCompleted(db, 999, true)).rejects.toThrow('does not exist');
  });

  it('orders pending before completed, then by due date with undated last', async () => {
    const done = await taskRepo.insertTask(db, { ...base, title: 'done', completed: true });
    const undated = await taskRepo.insertTask(db, { ...base, title: 'undated' });
    const later = await taskRepo.insertTask(db, { ...base, title: 'later', dueDateTime: '2030-02-01T00:00:00.000Z' });
    const sooner = await taskRepo.insertTask(db, { ...base, title: 'sooner', dueDateTime: '2030-01-01T00:00:00.000Z' });
    const ids = (await taskRepo.getAllTasks(db)).map((t) => t.id);
    expect(ids).toEqual([sooner.id, later.id, undated.id, done.id]);
  });

  it('uses bound parameters, so quotes in user input are stored verbatim', async () => {
    const title = "Robert'); DROP TABLE tasks;--";
    const created = await taskRepo.insertTask(db, { ...base, title });
    expect((await taskRepo.getTaskById(db, created.id))?.title).toBe(title);
    expect(await taskRepo.getAllTasks(db)).toHaveLength(1);
  });
});

describe('categoryRepository', () => {
  it('creates, lists (alphabetically) and renames categories', async () => {
    const work = await categoryRepo.insertCategory(db, ' Work ');
    await categoryRepo.insertCategory(db, 'errands');
    expect(work.name).toBe('Work');
    expect((await categoryRepo.getAllCategories(db)).map((c) => c.name)).toEqual(['errands', 'Work']);

    const renamed = await categoryRepo.renameCategory(db, work.id, 'Job');
    expect(renamed).toEqual({ id: work.id, name: 'Job' });
  });

  it('rejects empty names', async () => {
    await expect(categoryRepo.insertCategory(db, '  ')).rejects.toThrow('Category name is required.');
  });

  it('rejects duplicate names case-insensitively, on create and rename', async () => {
    const work = await categoryRepo.insertCategory(db, 'Work');
    const home = await categoryRepo.insertCategory(db, 'Home');
    await expect(categoryRepo.insertCategory(db, 'work')).rejects.toBeInstanceOf(
      categoryRepo.DuplicateCategoryError,
    );
    await expect(categoryRepo.renameCategory(db, home.id, 'WORK')).rejects.toBeInstanceOf(
      categoryRepo.DuplicateCategoryError,
    );
    // Changing only the case of its own name is allowed.
    await expect(categoryRepo.renameCategory(db, work.id, 'WORK')).resolves.toEqual({
      id: work.id,
      name: 'WORK',
    });
  });

  it('deleting a category keeps its tasks and uncategorises them', async () => {
    const work = await categoryRepo.insertCategory(db, 'Work');
    const other = await categoryRepo.insertCategory(db, 'Other');
    const a = await taskRepo.insertTask(db, { ...base, title: 'a', categoryId: work.id });
    const b = await taskRepo.insertTask(db, { ...base, title: 'b', categoryId: work.id });
    const c = await taskRepo.insertTask(db, { ...base, title: 'c', categoryId: other.id });
    expect(await categoryRepo.countTasksInCategory(db, work.id)).toBe(2);

    await categoryRepo.deleteCategory(db, work.id);

    expect((await categoryRepo.getAllCategories(db)).map((x) => x.id)).toEqual([other.id]);
    expect((await taskRepo.getTaskById(db, a.id))?.categoryId).toBeNull();
    expect((await taskRepo.getTaskById(db, b.id))?.categoryId).toBeNull();
    expect((await taskRepo.getTaskById(db, c.id))?.categoryId).toBe(other.id);
    expect(await taskRepo.getAllTasks(db)).toHaveLength(3);
  });

  it('rolls back the category delete transaction if a statement fails', async () => {
    const work = await categoryRepo.insertCategory(db, 'Work');
    const task = await taskRepo.insertTask(db, { ...base, categoryId: work.id });
    // Make the DELETE fail after the UPDATE has run inside the transaction.
    db.raw.exec(`CREATE TRIGGER block_delete BEFORE DELETE ON categories
                 BEGIN SELECT RAISE(ABORT, 'blocked'); END;`);
    await expect(categoryRepo.deleteCategory(db, work.id)).rejects.toThrow('blocked');
    expect((await taskRepo.getTaskById(db, task.id))?.categoryId).toBe(work.id);
    expect(await categoryRepo.getAllCategories(db)).toHaveLength(1);
  });
});
