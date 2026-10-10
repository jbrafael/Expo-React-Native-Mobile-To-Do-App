/**
 * Due dates are persisted as ISO 8601 UTC strings and shown in the device's local time zone.
 */

export function formatDueDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatDateOnly(date: Date): string {
  return date.toLocaleDateString(undefined, {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function formatTimeOnly(date: Date): string {
  return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

export function isPast(iso: string, now: Date = new Date()): boolean {
  return new Date(iso).getTime() <= now.getTime();
}

/** Keeps the calendar day of `day` and the clock time of `time` (both local), seconds zeroed. */
export function combineDateAndTime(day: Date, time: Date): Date {
  return new Date(
    day.getFullYear(),
    day.getMonth(),
    day.getDate(),
    time.getHours(),
    time.getMinutes(),
    0,
    0,
  );
}

/** Default due date for a new reminder: the next full hour from now. */
export function nextFullHour(now: Date = new Date()): Date {
  const d = new Date(now);
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + 1);
  return d;
}
