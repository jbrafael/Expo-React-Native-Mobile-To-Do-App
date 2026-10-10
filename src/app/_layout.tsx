import * as Notifications from 'expo-notifications';
import { router, Stack } from 'expo-router';
import { SQLiteProvider } from 'expo-sqlite';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { DATABASE_NAME, migrateDbIfNeeded } from '@/db/database';
import { configureNotifications, taskIdFromIdentifier } from '@/notifications/reminders';
import { TaskStoreProvider } from '@/state/TaskStore';
import { useColors } from '@/theme/colors';

// Set the foreground handler and Android channel as early as possible.
configureNotifications().catch((error) => console.warn('[layout] configureNotifications', error));

/** Opens the task editor when the user taps a reminder (warm start or cold start). */
function useOpenTaskFromNotification() {
  const response = Notifications.useLastNotificationResponse();
  const handled = useRef<string | null>(null);
  useEffect(() => {
    if (!response) return;
    const key = `${response.notification.request.identifier}:${response.notification.date}`;
    if (handled.current === key) return;
    handled.current = key;
    const taskId = taskIdFromIdentifier(response.notification.request.identifier);
    if (taskId !== null) {
      router.push({ pathname: '/task/[id]', params: { id: String(taskId) } });
    }
  }, [response]);
}

function AppStack() {
  const colors = useColors();
  useOpenTaskFromNotification();
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.surface },
        headerTintColor: colors.text,
        contentStyle: { backgroundColor: colors.background },
      }}>
      <Stack.Screen name="index" options={{ title: 'TaskFlow' }} />
      <Stack.Screen name="task/[id]" options={{ title: 'Task' }} />
      <Stack.Screen name="categories" options={{ title: 'Categories' }} />
    </Stack>
  );
}

export default function RootLayout() {
  const colors = useColors();
  const [dbError, setDbError] = useState<Error | null>(null);

  if (dbError) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <Text style={[styles.errorTitle, { color: colors.danger }]}>Database error</Text>
        <Text style={{ color: colors.text }}>{dbError.message}</Text>
      </View>
    );
  }

  return (
    // onInit runs the migrations before any child (and therefore any screen) renders.
    <SQLiteProvider databaseName={DATABASE_NAME} onInit={migrateDbIfNeeded} onError={setDbError}>
      <TaskStoreProvider>
        <AppStack />
        <StatusBar style="auto" />
      </TaskStoreProvider>
    </SQLiteProvider>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 8 },
  errorTitle: { fontSize: 18, fontWeight: '600' },
});
