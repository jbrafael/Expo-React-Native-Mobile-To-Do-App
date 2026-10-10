/**
 * Reminder lifecycle against an in-memory notification scheduler and a real SQLite database.
 * This verifies the app's logic (what it asks the OS to do); it does NOT prove that Android or
 * iOS deliver the notification — that requires on-device testing (see BUILD_LOG.md).
 *
 * @jest-environment node
 */
import { migrateDbIfNeeded } from '@/db/database';
import * as taskRepo from '@/db/taskRepository';
import type { Task, TaskInput } from '@/models/types';
import {
  isReminderEligible,
  reconcileReminders,
  reminderBody,
  reminderIdentifier,
  scheduleReminder,
  taskIdFromIdentifier,
} from '@/notifications/reminders';
import { syncTaskReminder } from '@/state/TaskStore';
import { fake } from '@/test/fakeNotifications';
import { createTestDb } from '@/test/sqliteTestDb';

// jest.mock factories are hoisted above imports, so the fake must be loaded with require().
// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('expo-notifications', () => require('@/test/fakeNotifications').module);
jest.mock('expo-sqlite', () => ({ useSQLiteContext: jest.fn() }));

const HOUR = 60 * 60 * 1000;
const inHours = (h: number) => new Date(Date.now() + h * HOUR).toISOString();

const base: TaskInput = {
  title: 'Submit mobile development assignment',
  description: null,
  completed: false,
  dueDateTime: null,
  categoryId: null,
};

let db: ReturnType<typeof createTestDb>;

/** Mirrors TaskStore: write via repository, then sync the reminder. */
async function create(input: Partial<TaskInput>) {
  const task = await taskRepo.insertTask(db, { ...base, ...input });
  const outcome = await syncTaskReminder(db, task);
  return { task: (await taskRepo.getTaskById(db, task.id))!, outcome };
}
async function update(task: Task, input: Partial<TaskInput>) {
  const updated = await taskRepo.updateTask(db, task.id, {
    title: task.title,
    description: task.description,
    completed: task.completed,
    dueDateTime: task.dueDateTime,
    categoryId: task.categoryId,
    ...input,
  });
  const outcome = await syncTaskReminder(db, updated);
  return { task: (await taskRepo.getTaskById(db, task.id))!, outcome };
}
async function setCompleted(task: Task, completed: boolean) {
  const updated = await taskRepo.setTaskCompleted(db, task.id, completed);
  const outcome = await syncTaskReminder(db, updated);
  return { task: (await taskRepo.getTaskById(db, task.id))!, outcome };
}

beforeEach(async () => {
  fake.reset();
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  db = createTestDb();
  await migrateDbIfNeeded(db);
});

afterEach(() => {
  db.close();
  jest.restoreAllMocks();
});

describe('helpers', () => {
  it('builds and parses deterministic identifiers', () => {
    expect(reminderIdentifier(42)).toBe('task-42');
    expect(taskIdFromIdentifier('task-42')).toBe(42);
    expect(taskIdFromIdentifier('other-42')).toBeNull();
    expect(taskIdFromIdentifier('task-abc')).toBeNull();
  });

  it('formats the body with the task title', () => {
    expect(reminderBody('Submit mobile development assignment')).toBe(
      'Task reminder: Submit mobile development assignment',
    );
  });

  it('eligibility requires a pending task with a future due date', () => {
    const now = new Date('2030-01-01T00:00:00.000Z');
    const t = { id: 1, title: 'x', completed: false, dueDateTime: '2030-01-01T00:00:01.000Z' };
    expect(isReminderEligible(t, now)).toBe(true);
    expect(isReminderEligible({ ...t, completed: true }, now)).toBe(false);
    expect(isReminderEligible({ ...t, dueDateTime: null }, now)).toBe(false);
    expect(isReminderEligible({ ...t, dueDateTime: '2030-01-01T00:00:00.000Z' }, now)).toBe(false);
    expect(isReminderEligible({ ...t, dueDateTime: 'not a date' }, now)).toBe(false);
  });
});

describe('lifecycle', () => {
  it('1. creating a task with a future due date schedules one reminder', async () => {
    const due = inHours(2);
    const { task, outcome } = await create({ dueDateTime: due });
    expect(outcome).toEqual({ status: 'scheduled', notificationId: `task-${task.id}` });
    expect(task.notificationId).toBe(`task-${task.id}`);
    const req = fake.scheduled.get(`task-${task.id}`)!;
    expect(req.content.body).toBe('Task reminder: Submit mobile development assignment');
    expect(req.trigger.value).toBe(new Date(due).getTime());
    expect(req.trigger.channelId).toBe('task-reminders');
    expect(fake.scheduled.size).toBe(1);
  });

  it('2. creating a task without a due date schedules nothing', async () => {
    const { task } = await create({});
    expect(fake.scheduled.size).toBe(0);
    expect(task.notificationId).toBeNull();
  });

  it('3. changing the due date replaces the reminder', async () => {
    const { task } = await create({ dueDateTime: inHours(2) });
    const newDue = inHours(5);
    await update(task, { dueDateTime: newDue });
    expect(fake.scheduled.size).toBe(1);
    expect(fake.scheduled.get(`task-${task.id}`)!.trigger.value).toBe(new Date(newDue).getTime());
  });

  it('4. removing the due date cancels the reminder', async () => {
    const { task } = await create({ dueDateTime: inHours(2) });
    const { task: after } = await update(task, { dueDateTime: null });
    expect(fake.scheduled.size).toBe(0);
    expect(after.notificationId).toBeNull();
  });

  it('5. completing a task cancels its reminder', async () => {
    const { task } = await create({ dueDateTime: inHours(2) });
    const { task: after } = await setCompleted(task, true);
    expect(fake.scheduled.size).toBe(0);
    expect(after.notificationId).toBeNull();
  });

  it('6. reopening schedules again only if the due date is still in the future', async () => {
    const { task } = await create({ dueDateTime: inHours(2) });
    await setCompleted(task, true);
    await setCompleted(task, false);
    expect(fake.scheduled.has(`task-${task.id}`)).toBe(true);

    // A completed task whose due date has passed must not be re-armed on reopen.
    const { task: old } = await create({ title: 'old', dueDateTime: inHours(2) });
    await setCompleted(old, true);
    db.raw.prepare('UPDATE tasks SET due_date_time = ? WHERE id = ?').run(inHours(-1), old.id);
    const { task: reopened, outcome } = await setCompleted(old, false);
    expect(outcome.status).toBe('cancelled');
    expect(fake.scheduled.has(`task-${old.id}`)).toBe(false);
    expect(reopened.notificationId).toBeNull();
  });

  it('7. deleting a task cancels its reminder (TaskStore.deleteTask order)', async () => {
    const { task } = await create({ dueDateTime: inHours(2) });
    const { cancelReminder } = jest.requireActual('@/notifications/reminders');
    await taskRepo.deleteTask(db, task.id);
    await cancelReminder(task.id);
    expect(fake.scheduled.size).toBe(0);
    expect(await taskRepo.getTaskById(db, task.id)).toBeNull();
  });

  it('8. a past due date never gets a reminder', async () => {
    const { task, outcome } = await create({ dueDateTime: inHours(-1) });
    expect(outcome.status).toBe('cancelled');
    expect(fake.scheduled.size).toBe(0);
    expect(task.dueDateTime).not.toBeNull(); // still saved
    expect(await scheduleReminder(task)).toEqual({ status: 'not-eligible' });
  });

  it('9. repeated scheduling and reconciliation keep exactly one reminder per task', async () => {
    const { task } = await create({ dueDateTime: inHours(2) });
    await scheduleReminder(task);
    await scheduleReminder(task);
    const all = await taskRepo.getAllTasks(db);
    await reconcileReminders(all);
    const second = await reconcileReminders(all);
    expect(fake.scheduled.size).toBe(1);
    expect(second.kept).toEqual([task.id]);
    expect(second.scheduled).toEqual([]);
  });

  it('10. permission denial does not throw and reports the outcome', async () => {
    fake.permission = { granted: false, canAskAgain: false };
    const { task, outcome } = await create({ dueDateTime: inHours(2) });
    expect(outcome).toEqual({ status: 'permission-denied' });
    expect(fake.scheduled.size).toBe(0);
    expect(task.notificationId).toBeNull();
  });

  it('10b. permission is requested only while undetermined', async () => {
    fake.permission = { granted: false, canAskAgain: true };
    fake.requestResult = { granted: true, canAskAgain: false };
    const { outcome } = await create({ dueDateTime: inHours(2) });
    expect(outcome.status).toBe('scheduled');
    expect(fake.requestCount).toBe(1);
    await create({ title: 'second', dueDateTime: inHours(3) });
    expect(fake.requestCount).toBe(1);
  });

  it('11. a scheduling failure leaves the task persisted', async () => {
    fake.failSchedule = true;
    const { task, outcome } = await create({ dueDateTime: inHours(2) });
    expect(outcome).toEqual({ status: 'error', message: 'native scheduling failed' });
    expect(await taskRepo.getTaskById(db, task.id)).not.toBeNull();
    expect(task.notificationId).toBeNull();
  });
});

describe('12. startup reconciliation', () => {
  it('schedules missing reminders, removes stale/orphaned ones, keeps foreign ones', async () => {
    const pending = await taskRepo.insertTask(db, { ...base, title: 'pending', dueDateTime: inHours(3) });
    const done = await taskRepo.insertTask(db, { ...base, title: 'done', completed: true, dueDateTime: inHours(3) });
    const moved = await taskRepo.insertTask(db, { ...base, title: 'moved', dueDateTime: inHours(4) });

    const stale = (id: number, due: string) => ({
      identifier: `task-${id}`,
      content: { body: 'x', data: { taskId: id, dueDateTime: due } },
      trigger: { type: 'date' as const, value: new Date(due).getTime() },
    });
    fake.scheduled.set(`task-${done.id}`, stale(done.id, inHours(3))); // completed → cancel
    fake.scheduled.set(`task-${moved.id}`, stale(moved.id, inHours(1))); // wrong date → replace
    fake.scheduled.set('task-999', stale(999, inHours(1))); // deleted task → cancel
    fake.scheduled.set('someone-else', { ...stale(1, inHours(1)), identifier: 'someone-else' });

    const report = await reconcileReminders(await taskRepo.getAllTasks(db));

    expect(report.cancelled.sort()).toEqual([`task-${done.id}`, `task-${moved.id}`, 'task-999'].sort());
    expect(report.scheduled.sort()).toEqual([pending.id, moved.id].sort());
    expect([...fake.scheduled.keys()].sort()).toEqual(
      [`task-${pending.id}`, `task-${moved.id}`, 'someone-else'].sort(),
    );
    expect(fake.scheduled.get(`task-${moved.id}`)!.trigger.value).toBe(
      new Date(moved.dueDateTime!).getTime(),
    );
  });

  it('does not prompt for permission and schedules nothing when not granted', async () => {
    fake.permission = { granted: false, canAskAgain: true };
    await taskRepo.insertTask(db, { ...base, dueDateTime: inHours(3) });
    const report = await reconcileReminders(await taskRepo.getAllTasks(db));
    expect(report.permission).toBe('undetermined');
    expect(fake.requestCount).toBe(0);
    expect(fake.scheduled.size).toBe(0);
  });
});
