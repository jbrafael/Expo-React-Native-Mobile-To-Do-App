import type { CategoryFilter, StatusFilter, Task } from '@/models/types';

/** Pure filter used by the task list; status and category filters combine with AND. */
export function filterTasks(
  tasks: Task[],
  status: StatusFilter,
  category: CategoryFilter,
): Task[] {
  return tasks.filter((task) => {
    if (status === 'pending' && task.completed) return false;
    if (status === 'completed' && !task.completed) return false;
    if (category === 'none' && task.categoryId !== null) return false;
    if (typeof category === 'number' && task.categoryId !== category) return false;
    return true;
  });
}
