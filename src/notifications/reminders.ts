/**
 * Centralised local-reminder service. This is the only module that talks to expo-notifications.
 *
 * Design:
 * - Each task has at most one reminder, identified deterministically as `task-<id>`.
 *   Scheduling always cancels that identifier first, so repeated calls (and repeated
 *   reconciliation) can never leave two reminders for one task.
 * - A task is eligible for a reminder only if it is pending and its due date is in the future.
 * - Every function catches notification errors and reports them through the return value;
 *   callers persist tasks regardless, so a notification failure never loses data.
 */
import Constants, { ExecutionEnvironment } from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import type { Task } from '@/models/types';

export const REMINDER_CHANNEL_ID = 'task-reminders';
const IDENTIFIER_PREFIX = 'task-';

export type ReminderTask = Pick<Task, 'id' | 'title' | 'completed' | 'dueDateTime'>;

export function reminderIdentifier(taskId: number): string {
  return `${IDENTIFIER_PREFIX}${taskId}`;
}

/** Returns the task id for identifiers created by this app, otherwise null. */
export function taskIdFromIdentifier(identifier: string): number | null {
  if (!identifier.startsWith(IDENTIFIER_PREFIX)) return null;
  const id = Number(identifier.slice(IDENTIFIER_PREFIX.length));
  return Number.isInteger(id) && id > 0 ? id : null;
}

export function reminderBody(title: string): string {
  return `Task reminder: ${title}`;
}

/** Pending task whose due date is strictly in the future. */
export function isReminderEligible(task: ReminderTask, now: Date = new Date()): boolean {
  if (task.completed || !task.dueDateTime) return false;
  const due = new Date(task.dueDateTime).getTime();
  return Number.isFinite(due) && due > now.getTime();
}

let configured = false;

/**
 * Sets the foreground presentation handler and creates the Android channel.
 * Must run before requesting permission: on Android 13+ the OS prompt only appears once a
 * channel exists.
 */
export async function configureNotifications(): Promise<void> {
  if (configured) return;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldPlaySound: true,
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(REMINDER_CHANNEL_ID, {
      name: 'Task reminders',
      description: 'Reminders when a task is due',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
    });
  }
  configured = true;
}

export type PermissionState = 'granted' | 'denied' | 'undetermined';

function toPermissionState(
  settings: Notifications.NotificationPermissionsStatus,
): PermissionState {
  if (
    settings.granted ||
    settings.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL
  ) {
    return 'granted';
  }
  return settings.canAskAgain ? 'undetermined' : 'denied';
}

export async function getPermissionState(): Promise<PermissionState> {
  try {
    return toPermissionState(await Notifications.getPermissionsAsync());
  } catch (error) {
    console.warn('[reminders] getPermissionsAsync failed', error);
    return 'denied';
  }
}

/** Asks the OS only when the user has not answered yet. Never throws. */
export async function ensurePermission(): Promise<PermissionState> {
  try {
    await configureNotifications();
    const current = toPermissionState(await Notifications.getPermissionsAsync());
    if (current !== 'undetermined') return current;
    const requested = await Notifications.requestPermissionsAsync({
      ios: { allowAlert: true, allowSound: true, allowBadge: false },
    });
    return toPermissionState(requested);
  } catch (error) {
    console.warn('[reminders] permission request failed', error);
    return 'denied';
  }
}

export async function cancelReminder(taskId: number): Promise<void> {
  try {
    await Notifications.cancelScheduledNotificationAsync(reminderIdentifier(taskId));
  } catch (error) {
    // Cancelling an unknown identifier is harmless; log anything else.
    console.warn(`[reminders] cancel failed for task ${taskId}`, error);
  }
}

export type ScheduleResult =
  | { status: 'scheduled'; notificationId: string }
  | { status: 'not-eligible' }
  | { status: 'permission-denied' }
  | { status: 'error'; message: string };

/**
 * Schedules (or replaces) the reminder for a task. Does nothing but cancel when the task is not
 * eligible.
 */
export async function scheduleReminder(
  task: ReminderTask,
  now: Date = new Date(),
): Promise<ScheduleResult> {
  await cancelReminder(task.id);
  if (!isReminderEligible(task, now)) {
    return { status: 'not-eligible' };
  }
  const permission = await ensurePermission();
  if (permission !== 'granted') {
    return { status: 'permission-denied' };
  }
  try {
    const notificationId = await Notifications.scheduleNotificationAsync({
      identifier: reminderIdentifier(task.id),
      content: {
        title: 'TaskFlow',
        body: reminderBody(task.title),
        // The due date is stored in the payload so the fire time can be shown on every platform
        // (iOS reports date triggers back as relative `timeInterval` triggers).
        data: { taskId: task.id, dueDateTime: task.dueDateTime },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: new Date(task.dueDateTime!),
        channelId: REMINDER_CHANNEL_ID,
      },
    });
    return { status: 'scheduled', notificationId };
  } catch (error) {
    console.warn(`[reminders] schedule failed for task ${task.id}`, error);
    return { status: 'error', message: error instanceof Error ? error.message : String(error) };
  }
}

/** Alias that documents intent at call sites where a reminder may already exist. */
export const rescheduleReminder = scheduleReminder;

export interface ReconcileReport {
  /** Task ids whose reminder was (re-)armed. */
  scheduled: number[];
  /** Identifiers of app reminders that were removed. */
  cancelled: string[];
  failed: number[];
  permission: PermissionState;
}

/**
 * Makes the OS's scheduled reminders match the persisted tasks:
 * - cancels app reminders whose task no longer exists, is completed, or is past due;
 * - re-arms the reminder of **every** eligible task (cancel + schedule, same identifier).
 *
 * Re-arming instead of trusting `getAllScheduledNotificationsAsync()` is deliberate: on Android
 * that call reads expo-notifications' persisted request store, which survives a force-stop even
 * though the OS has deleted the underlying AlarmManager alarms (verified on an emulator, see
 * BUILD_LOG.md Entry 9). Because the identifier is deterministic, re-arming is idempotent:
 * running it any number of times leaves exactly one reminder per eligible task.
 *
 * Does not prompt for permission (startup should not ambush the user); if permission is not
 * granted, nothing new is scheduled.
 */
export async function reconcileReminders(
  tasks: ReminderTask[],
  now: Date = new Date(),
): Promise<ReconcileReport> {
  const report: ReconcileReport = {
    scheduled: [],
    cancelled: [],
    failed: [],
    permission: 'undetermined',
  };
  try {
    await configureNotifications();
  } catch (error) {
    console.warn('[reminders] configure failed during reconcile', error);
  }
  report.permission = await getPermissionState();

  let existing: Notifications.NotificationRequest[] = [];
  try {
    existing = await Notifications.getAllScheduledNotificationsAsync();
  } catch (error) {
    console.warn('[reminders] could not list scheduled notifications', error);
  }

  const eligible = tasks.filter((t) => isReminderEligible(t, now));
  const eligibleIds = new Set(eligible.map((t) => t.id));

  for (const request of existing) {
    const taskId = taskIdFromIdentifier(request.identifier);
    if (taskId === null || eligibleIds.has(taskId)) continue; // not ours, or re-armed below
    try {
      await Notifications.cancelScheduledNotificationAsync(request.identifier);
      report.cancelled.push(request.identifier);
    } catch (error) {
      console.warn(`[reminders] reconcile cancel failed for ${request.identifier}`, error);
    }
  }

  if (report.permission !== 'granted') return report;

  for (const task of eligible) {
    const result = await scheduleReminder(task, now);
    if (result.status === 'scheduled') report.scheduled.push(task.id);
    else report.failed.push(task.id);
  }
  return report;
}

/**
 * Fire time (ms) of a scheduled request, for display. Android date triggers are serialised as
 * `{ type: 'date', value: <ms> }` (see NotificationTriggers.kt); iOS turns them into relative
 * `timeInterval` triggers, so we fall back to the due date stored in the payload.
 */
function scheduledDate(request: Notifications.NotificationRequest): number | null {
  const trigger = request.trigger as unknown as Record<string, unknown> | null;
  if (trigger && typeof trigger.value === 'number') return trigger.value;
  const due = request.content.data?.dueDateTime;
  if (typeof due === 'string') {
    const ms = new Date(due).getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  return null;
}

/** Lists this app's scheduled reminders, for the diagnostics panel. */
export async function listScheduledReminders(): Promise<
  { identifier: string; taskId: number | null; fireAt: number | null; body: string | null }[]
> {
  try {
    const requests = await Notifications.getAllScheduledNotificationsAsync();
    return requests.map((r) => ({
      identifier: r.identifier,
      taskId: taskIdFromIdentifier(r.identifier),
      fireAt: scheduledDate(r),
      body: r.content.body,
    }));
  } catch (error) {
    console.warn('[reminders] listScheduledReminders failed', error);
    return [];
  }
}

export function runtimeDescription(): string {
  const env =
    Constants.executionEnvironment === ExecutionEnvironment.StoreClient
      ? 'Expo Go'
      : Constants.executionEnvironment === ExecutionEnvironment.Bare
        ? 'Development/standalone build'
        : 'Standalone build';
  const device = Device.isDevice ? 'physical device' : 'emulator/simulator';
  return `${env} on ${Platform.OS} ${Platform.Version} (${device})`;
}
