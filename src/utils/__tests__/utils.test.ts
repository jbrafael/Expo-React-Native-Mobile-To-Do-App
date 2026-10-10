import type { Task } from '@/models/types';
import { combineDateAndTime, isPast, nextFullHour } from '@/utils/dates';
import { filterTasks } from '@/utils/filterTasks';

function task(id: number, completed: boolean, categoryId: number | null): Task {
  return {
    id,
    title: `t${id}`,
    description: null,
    completed,
    dueDateTime: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    categoryId,
    notificationId: null,
  };
}

const tasks = [task(1, false, null), task(2, true, 10), task(3, false, 10), task(4, true, 20)];
const ids = (list: Task[]) => list.map((t) => t.id);

describe('filterTasks', () => {
  it('filters by status', () => {
    expect(ids(filterTasks(tasks, 'all', 'all'))).toEqual([1, 2, 3, 4]);
    expect(ids(filterTasks(tasks, 'pending', 'all'))).toEqual([1, 3]);
    expect(ids(filterTasks(tasks, 'completed', 'all'))).toEqual([2, 4]);
  });

  it('filters by category, including uncategorised', () => {
    expect(ids(filterTasks(tasks, 'all', 10))).toEqual([2, 3]);
    expect(ids(filterTasks(tasks, 'all', 'none'))).toEqual([1]);
  });

  it('combines status and category', () => {
    expect(ids(filterTasks(tasks, 'pending', 10))).toEqual([3]);
    expect(ids(filterTasks(tasks, 'completed', 'none'))).toEqual([]);
  });
});

describe('dates', () => {
  it('combines the day of one date with the time of another', () => {
    const day = new Date(2030, 4, 17, 8, 0);
    const time = new Date(2001, 0, 1, 21, 45, 33);
    expect(combineDateAndTime(day, time)).toEqual(new Date(2030, 4, 17, 21, 45, 0, 0));
  });

  it('computes the next full hour', () => {
    expect(nextFullHour(new Date(2030, 0, 1, 9, 10, 5))).toEqual(new Date(2030, 0, 1, 10, 0, 0, 0));
    expect(nextFullHour(new Date(2030, 0, 1, 23, 30))).toEqual(new Date(2030, 0, 2, 0, 0, 0, 0));
  });

  it('detects past due dates', () => {
    const now = new Date('2030-01-01T12:00:00.000Z');
    expect(isPast('2030-01-01T11:59:59.000Z', now)).toBe(true);
    expect(isPast('2030-01-01T12:00:00.000Z', now)).toBe(true);
    expect(isPast('2030-01-01T12:00:01.000Z', now)).toBe(false);
  });
});
