import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import TaskEditorScreen from '@/app/task/[id]';
import type { Task } from '@/models/types';

const mockStore = {
  categories: [{ id: 7, name: 'Work' }],
  loadTask: jest.fn(),
  createTask: jest.fn(),
  updateTask: jest.fn(),
  deleteTask: jest.fn(),
};
let mockParams: { id: string } = { id: 'new' };
const mockBack = jest.fn();

jest.mock('@/state/TaskStore', () => ({
  useTaskStore: () => mockStore,
  describeReminderOutcome: () => null,
}));
jest.mock('expo-router', () => ({
  Stack: { Screen: () => null },
  router: { back: () => mockBack() },
  useLocalSearchParams: () => mockParams,
  useNavigation: () => ({ dispatch: jest.fn() }),
}));
jest.mock('@react-navigation/native', () => ({ usePreventRemove: jest.fn() }));

const existing: Task = {
  id: 3,
  title: 'Buy milk',
  description: 'Semi-skimmed',
  completed: false,
  dueDateTime: null,
  createdAt: '2026-10-10T12:00:00.000Z',
  categoryId: 7,
  notificationId: null,
};

beforeEach(() => {
  jest.clearAllMocks();
  mockParams = { id: 'new' };
  mockStore.createTask.mockResolvedValue({ task: existing, reminder: { status: 'cancelled' } });
  mockStore.updateTask.mockResolvedValue({ task: existing, reminder: { status: 'cancelled' } });
});

it('rejects an empty title and does not save', async () => {
  render(<TaskEditorScreen />);
  fireEvent.changeText(screen.getByTestId('title-input'), '    ');
  fireEvent.press(screen.getByTestId('save-button'));
  expect(await screen.findByTestId('title-error')).toHaveTextContent('Title is required.');
  expect(mockStore.createTask).not.toHaveBeenCalled();
});

it('creates a task with the entered values and navigates back', async () => {
  render(<TaskEditorScreen />);
  fireEvent.changeText(screen.getByTestId('title-input'), 'Call the bank');
  fireEvent.changeText(screen.getByTestId('description-input'), 'About the card');
  fireEvent.press(screen.getByText('Work'));
  fireEvent.press(screen.getByTestId('save-button'));
  await waitFor(() => expect(mockBack).toHaveBeenCalled());
  expect(mockStore.createTask).toHaveBeenCalledWith({
    title: 'Call the bank',
    description: 'About the card',
    completed: false,
    dueDateTime: null,
    categoryId: 7,
  });
});

it('loads an existing task by id and saves edits through updateTask', async () => {
  mockParams = { id: '3' };
  mockStore.loadTask.mockResolvedValue(existing);
  render(<TaskEditorScreen />);
  const title = await screen.findByDisplayValue('Buy milk');
  expect(mockStore.loadTask).toHaveBeenCalledWith(3);
  expect(screen.getByDisplayValue('Semi-skimmed')).toBeTruthy();

  fireEvent.changeText(title, 'Buy oat milk');
  fireEvent(screen.getByTestId('completed-switch'), 'valueChange', true);
  fireEvent.press(screen.getByTestId('save-button'));
  await waitFor(() => expect(mockStore.updateTask).toHaveBeenCalled());
  expect(mockStore.updateTask).toHaveBeenCalledWith(3, {
    title: 'Buy oat milk',
    description: 'Semi-skimmed',
    completed: true,
    dueDateTime: null,
    categoryId: 7,
  });
});

it('shows a not-found state for a missing task', async () => {
  mockParams = { id: '404' };
  mockStore.loadTask.mockResolvedValue(null);
  render(<TaskEditorScreen />);
  expect(await screen.findByText('This task no longer exists.')).toBeTruthy();
});
