/**
 * Domain models shared by the data layer, state layer and screens.
 *
 * Timestamps (`dueDateTime`, `createdAt`) are ISO 8601 strings in UTC, as produced by
 * `Date.prototype.toISOString()` (e.g. "2026-10-11T18:30:00.000Z"). They are converted to
 * the device's local time zone only for display and picking.
 */

export interface Category {
  id: number;
  name: string;
}

export interface Task {
  id: number;
  title: string;
  description: string | null;
  completed: boolean;
  /** Optional due date/time, ISO 8601 UTC. */
  dueDateTime: string | null;
  /** Creation timestamp, ISO 8601 UTC. */
  createdAt: string;
  categoryId: number | null;
  /** Identifier of the currently scheduled local notification, or null when none is scheduled. */
  notificationId: string | null;
}

/** Fields the user can edit when creating or updating a task. */
export interface TaskInput {
  title: string;
  description: string | null;
  completed: boolean;
  dueDateTime: string | null;
  categoryId: number | null;
}

export type StatusFilter = 'all' | 'pending' | 'completed';

/** `'all'` = any category, `'none'` = uncategorised tasks only, number = that category. */
export type CategoryFilter = 'all' | 'none' | number;
