/**
 * Shared task/category state for all screens (ViewModel-style layer).
 *
 * Refresh strategy: SQLite queries are not reactive, so every mutation here
 *   1. writes through a repository,
 *   2. syncs the task's reminder (failures are reported, never thrown — the task stays saved),
 *   3. calls `refresh()`, which re-reads tasks and categories into React state.
 * Screens only read `tasks` / `categories` and call these mutation functions.
 */
import { useSQLiteContext } from 'expo-sqlite';
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import * as categoryRepo from '@/db/categoryRepository';
import type { Db } from '@/db/database';
import * as taskRepo from '@/db/taskRepository';
import type { Category, Task, TaskInput } from '@/models/types';
import {
  cancelReminder,
  getPermissionState,
  isReminderEligible,
  type PermissionState,
  reconcileReminders,
  reminderIdentifier,
  scheduleReminder,
  type ScheduleResult,
} from '@/notifications/reminders';

export type ReminderOutcome = ScheduleResult | { status: 'cancelled' };

export interface MutationResult {
  task: Task;
  reminder: ReminderOutcome;
}

interface TaskStoreValue {
  tasks: Task[];
  categories: Category[];
  loading: boolean;
  error: string | null;
  permission: PermissionState;
  refresh: () => Promise<void>;
  loadTask: (id: number) => Promise<Task | null>;
  createTask: (input: TaskInput) => Promise<MutationResult>;
  updateTask: (id: number, input: TaskInput) => Promise<MutationResult>;
  setCompleted: (id: number, completed: boolean) => Promise<MutationResult>;
  deleteTask: (id: number) => Promise<void>;
  createCategory: (name: string) => Promise<Category>;
  renameCategory: (id: number, name: string) => Promise<Category>;
  deleteCategory: (id: number) => Promise<void>;
  countTasksInCategory: (id: number) => Promise<number>;
  reconcile: () => Promise<void>;
}

const TaskStoreContext = createContext<TaskStoreValue | null>(null);

/**
 * Cancels or (re)schedules the task's reminder and records the outcome in `notification_id`.
 * Exported for unit tests.
 */
export async function syncTaskReminder(db: Db, task: Task): Promise<ReminderOutcome> {
  let outcome: ReminderOutcome;
  if (isReminderEligible(task)) {
    outcome = await scheduleReminder(task);
  } else {
    await cancelReminder(task.id);
    outcome = { status: 'cancelled' };
  }
  const notificationId = outcome.status === 'scheduled' ? outcome.notificationId : null;
  if (notificationId !== task.notificationId) {
    try {
      await taskRepo.setTaskNotificationId(db, task.id, notificationId);
    } catch (error) {
      console.warn('[TaskStore] could not persist notification id', error);
    }
  }
  return outcome;
}

export function TaskStoreProvider({ children }: { children: ReactNode }) {
  const db = useSQLiteContext();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [permission, setPermission] = useState<PermissionState>('undetermined');
  const reconciledOnce = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const [nextTasks, nextCategories] = await Promise.all([
        taskRepo.getAllTasks(db),
        categoryRepo.getAllCategories(db),
      ]);
      setTasks(nextTasks);
      setCategories(nextCategories);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [db]);

  const reconcile = useCallback(async () => {
    const all = await taskRepo.getAllTasks(db);
    const report = await reconcileReminders(all);
    setPermission(report.permission);
    // Keep notification_id in SQLite consistent with what is actually scheduled.
    const active = new Set([...report.kept, ...report.scheduled]);
    for (const task of all) {
      const expected = active.has(task.id) ? reminderIdentifier(task.id) : null;
      if (task.notificationId !== expected) {
        await taskRepo.setTaskNotificationId(db, task.id, expected);
      }
    }
    if (__DEV__) {
      console.log('[TaskStore] reminders reconciled', report);
    }
    await refresh();
  }, [db, refresh]);

  // Startup: load data first so the UI is usable, then reconcile reminders in the background.
  useEffect(() => {
    if (reconciledOnce.current) return;
    reconciledOnce.current = true;
    (async () => {
      await refresh();
      try {
        await reconcile();
      } catch (e) {
        console.warn('[TaskStore] startup reconciliation failed', e);
      }
    })();
  }, [refresh, reconcile]);

  const afterReminderChange = useCallback(
    async (outcome: ReminderOutcome) => {
      if (outcome.status === 'permission-denied' || outcome.status === 'scheduled') {
        setPermission(await getPermissionState());
      }
    },
    [],
  );

  const loadTask = useCallback((id: number) => taskRepo.getTaskById(db, id), [db]);

  const createTask = useCallback(
    async (input: TaskInput) => {
      const task = await taskRepo.insertTask(db, input);
      const reminder = await syncTaskReminder(db, task);
      await afterReminderChange(reminder);
      await refresh();
      return { task, reminder };
    },
    [db, refresh, afterReminderChange],
  );

  const updateTask = useCallback(
    async (id: number, input: TaskInput) => {
      const task = await taskRepo.updateTask(db, id, input);
      const reminder = await syncTaskReminder(db, task);
      await afterReminderChange(reminder);
      await refresh();
      return { task, reminder };
    },
    [db, refresh, afterReminderChange],
  );

  const setCompleted = useCallback(
    async (id: number, completed: boolean) => {
      const task = await taskRepo.setTaskCompleted(db, id, completed);
      const reminder = await syncTaskReminder(db, task);
      await afterReminderChange(reminder);
      await refresh();
      return { task, reminder };
    },
    [db, refresh, afterReminderChange],
  );

  const deleteTask = useCallback(
    async (id: number) => {
      await taskRepo.deleteTask(db, id);
      await cancelReminder(id);
      await refresh();
    },
    [db, refresh],
  );

  const createCategory = useCallback(
    async (name: string) => {
      const category = await categoryRepo.insertCategory(db, name);
      await refresh();
      return category;
    },
    [db, refresh],
  );

  const renameCategory = useCallback(
    async (id: number, name: string) => {
      const category = await categoryRepo.renameCategory(db, id, name);
      await refresh();
      return category;
    },
    [db, refresh],
  );

  const deleteCategory = useCallback(
    async (id: number) => {
      await categoryRepo.deleteCategory(db, id);
      await refresh();
    },
    [db, refresh],
  );

  const countTasksInCategory = useCallback(
    (id: number) => categoryRepo.countTasksInCategory(db, id),
    [db],
  );

  const value = useMemo<TaskStoreValue>(
    () => ({
      tasks,
      categories,
      loading,
      error,
      permission,
      refresh,
      loadTask,
      createTask,
      updateTask,
      setCompleted,
      deleteTask,
      createCategory,
      renameCategory,
      deleteCategory,
      countTasksInCategory,
      reconcile,
    }),
    [
      tasks,
      categories,
      loading,
      error,
      permission,
      refresh,
      loadTask,
      createTask,
      updateTask,
      setCompleted,
      deleteTask,
      createCategory,
      renameCategory,
      deleteCategory,
      countTasksInCategory,
      reconcile,
    ],
  );

  return <TaskStoreContext.Provider value={value}>{children}</TaskStoreContext.Provider>;
}

export function useTaskStore(): TaskStoreValue {
  const value = useContext(TaskStoreContext);
  if (!value) {
    throw new Error('useTaskStore must be used inside <TaskStoreProvider>.');
  }
  return value;
}

/** Human-readable feedback for a reminder outcome, or null when nothing needs saying. */
export function describeReminderOutcome(outcome: ReminderOutcome): string | null {
  switch (outcome.status) {
    case 'scheduled':
      return 'Reminder scheduled.';
    case 'permission-denied':
      return 'Task saved, but notifications are not allowed, so no reminder was scheduled.';
    case 'error':
      return `Task saved, but the reminder could not be scheduled (${outcome.message}).`;
    default:
      return null;
  }
}
