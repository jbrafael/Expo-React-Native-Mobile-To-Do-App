/**
 * In-memory stand-in for expo-notifications, used via
 * `jest.mock('expo-notifications', () => require('@/test/fakeNotifications').module)`.
 * It mimics the native behaviour that matters here: requests are keyed by identifier
 * (re-scheduling an identifier replaces it) and Android-style date triggers.
 */
export interface FakeRequest {
  identifier: string;
  content: { title?: string; body: string | null; data: Record<string, unknown> };
  trigger: { type: 'date'; value: number; channelId?: string };
}

export const fake = {
  scheduled: new Map<string, FakeRequest>(),
  permission: { granted: true, canAskAgain: true },
  /** Permission returned after a request prompt. */
  requestResult: { granted: true, canAskAgain: false },
  failSchedule: false,
  requestCount: 0,
  reset() {
    this.scheduled.clear();
    this.permission = { granted: true, canAskAgain: true };
    this.requestResult = { granted: true, canAskAgain: false };
    this.failSchedule = false;
    this.requestCount = 0;
  },
};

export const module = {
  SchedulableTriggerInputTypes: { DATE: 'date' },
  AndroidImportance: { HIGH: 4 },
  IosAuthorizationStatus: { PROVISIONAL: 3 },
  setNotificationHandler: jest.fn(),
  setNotificationChannelAsync: jest.fn(async () => null),
  getPermissionsAsync: jest.fn(async () => ({ ...fake.permission, status: '' })),
  requestPermissionsAsync: jest.fn(async () => {
    fake.requestCount += 1;
    fake.permission = { ...fake.requestResult };
    return { ...fake.permission, status: '' };
  }),
  scheduleNotificationAsync: jest.fn(
    async (req: {
      identifier: string;
      content: FakeRequest['content'];
      trigger: { date: Date; channelId?: string };
    }) => {
      if (fake.failSchedule) throw new Error('native scheduling failed');
      fake.scheduled.set(req.identifier, {
        identifier: req.identifier,
        content: req.content,
        trigger: { type: 'date', value: req.trigger.date.getTime(), channelId: req.trigger.channelId },
      });
      return req.identifier;
    },
  ),
  cancelScheduledNotificationAsync: jest.fn(async (id: string) => {
    fake.scheduled.delete(id);
  }),
  getAllScheduledNotificationsAsync: jest.fn(async () => [...fake.scheduled.values()]),
};
