import Ionicons from '@expo/vector-icons/Ionicons';
import { router, Stack } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Chip } from '@/components/Chip';
import { PermissionBanner } from '@/components/PermissionBanner';
import { TaskRow } from '@/components/TaskRow';
import type { CategoryFilter, StatusFilter, Task } from '@/models/types';
import { describeReminderOutcome, useTaskStore } from '@/state/TaskStore';
import { useColors } from '@/theme/colors';
import { filterTasks } from '@/utils/filterTasks';

const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'pending', label: 'Pending' },
  { value: 'completed', label: 'Completed' },
];

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Screen A — task list with status/category filters. */
export default function TaskListScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { tasks, categories, loading, error, permission, refresh, setCompleted, deleteTask } =
    useTaskStore();
  const [status, setStatus] = useState<StatusFilter>('all');
  const [category, setCategory] = useState<CategoryFilter>('all');

  // If the selected category is deleted, fall back to "All".
  useEffect(() => {
    if (typeof category === 'number' && !categories.some((c) => c.id === category)) {
      setCategory('all');
    }
  }, [categories, category]);

  const categoryNames = useMemo(
    () => new Map(categories.map((c) => [c.id, c.name] as const)),
    [categories],
  );
  const visible = useMemo(() => filterTasks(tasks, status, category), [tasks, status, category]);

  const openEditor = (id: number | 'new') =>
    router.push({ pathname: '/task/[id]', params: { id: String(id) } });

  const toggle = async (task: Task) => {
    try {
      const { reminder } = await setCompleted(task.id, !task.completed);
      const message = describeReminderOutcome(reminder);
      if (message && reminder.status !== 'scheduled') Alert.alert('Reminder', message);
    } catch (e) {
      Alert.alert('Could not update task', errorMessage(e));
    }
  };

  const confirmDelete = (task: Task) => {
    Alert.alert('Delete task?', `"${task.title}" will be permanently deleted.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteTask(task.id);
          } catch (e) {
            Alert.alert('Could not delete task', errorMessage(e));
          }
        },
      },
    ]);
  };

  const emptyText =
    tasks.length === 0
      ? 'No tasks yet. Tap + to create your first task.'
      : 'No tasks match the selected filters.';

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Stack.Screen
        options={{
          headerRight: () => (
            <Pressable
              onPress={() => router.push('/categories')}
              accessibilityRole="button"
              accessibilityLabel="Manage categories"
              hitSlop={10}>
              <Ionicons name="pricetags-outline" size={22} color={colors.primary} />
            </Pressable>
          ),
        }}
      />

      <View style={styles.filters}>
        <View style={styles.row}>
          {STATUS_FILTERS.map((f) => (
            <Chip
              key={f.value}
              label={f.label}
              selected={status === f.value}
              onPress={() => setStatus(f.value)}
              testID={`status-${f.value}`}
            />
          ))}
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
          <Chip label="Any category" selected={category === 'all'} onPress={() => setCategory('all')} />
          <Chip label="Uncategorized" selected={category === 'none'} onPress={() => setCategory('none')} />
          {categories.map((c) => (
            <Chip key={c.id} label={c.name} selected={category === c.id} onPress={() => setCategory(c.id)} />
          ))}
        </ScrollView>
        {permission === 'denied' ? <PermissionBanner /> : null}
      </View>

      {loading ? (
        <ActivityIndicator style={styles.loading} size="large" color={colors.primary} />
      ) : error ? (
        <View style={styles.empty}>
          <Text style={[styles.emptyText, { color: colors.danger }]}>Could not load tasks: {error}</Text>
          <Pressable onPress={refresh} accessibilityRole="button">
            <Text style={[styles.retry, { color: colors.primary }]}>Retry</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={visible}
          keyExtractor={(t) => String(t.id)}
          contentContainerStyle={styles.list}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Ionicons name="checkbox-outline" size={40} color={colors.textMuted} />
              <Text style={[styles.emptyText, { color: colors.textMuted }]}>{emptyText}</Text>
            </View>
          }
          renderItem={({ item }) => (
            <TaskRow
              task={item}
              categoryName={item.categoryId !== null ? (categoryNames.get(item.categoryId) ?? null) : null}
              onPress={() => openEditor(item.id)}
              onToggle={() => toggle(item)}
              onDelete={() => confirmDelete(item)}
            />
          )}
        />
      )}

      <Pressable
        onPress={() => openEditor('new')}
        accessibilityRole="button"
        accessibilityLabel="Create task"
        testID="create-task"
        style={({ pressed }) => [
          styles.fab,
          { bottom: 24 + insets.bottom, backgroundColor: colors.primary, opacity: pressed ? 0.85 : 1 },
        ]}>
        <Ionicons name="add" size={30} color={colors.primaryText} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  filters: { paddingHorizontal: 16, paddingTop: 12, gap: 10 },
  row: { flexDirection: 'row', gap: 8 },
  list: { padding: 16, paddingBottom: 110, flexGrow: 1 },
  separator: { height: 10 },
  loading: { marginTop: 48 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 32 },
  emptyText: { fontSize: 15, textAlign: 'center' },
  retry: { fontSize: 15, fontWeight: '600' },
  fab: {
    position: 'absolute',
    right: 20,
    width: 60,
    height: 60,
    borderRadius: 30,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
  },
});
