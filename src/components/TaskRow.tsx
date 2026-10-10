import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { Task } from '@/models/types';
import { useColors } from '@/theme/colors';
import { formatDueDate, isPast } from '@/utils/dates';

interface TaskRowProps {
  task: Task;
  categoryName: string | null;
  onPress: () => void;
  onToggle: () => void;
  onDelete: () => void;
}

export function TaskRow({ task, categoryName, onPress, onToggle, onDelete }: TaskRowProps) {
  const colors = useColors();
  const overdue = !task.completed && task.dueDateTime !== null && isPast(task.dueDateTime);

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Edit task ${task.title}`}
      style={[styles.row, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <Pressable
        onPress={onToggle}
        hitSlop={10}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: task.completed }}
        accessibilityLabel={task.completed ? 'Mark as pending' : 'Mark as completed'}
        testID={`toggle-${task.id}`}>
        <Ionicons
          name={task.completed ? 'checkmark-circle' : 'ellipse-outline'}
          size={26}
          color={task.completed ? colors.success : colors.textMuted}
        />
      </Pressable>

      <View style={styles.body}>
        <Text
          numberOfLines={2}
          style={[
            styles.title,
            { color: task.completed ? colors.textMuted : colors.text },
            task.completed && styles.completedTitle,
          ]}>
          {task.title}
        </Text>
        <View style={styles.meta}>
          {categoryName ? (
            <View style={[styles.chip, { backgroundColor: colors.chip }]}>
              <Text style={[styles.chipText, { color: colors.chipText }]}>{categoryName}</Text>
            </View>
          ) : null}
          {task.dueDateTime ? (
            <View style={styles.due}>
              <Ionicons
                name={task.notificationId ? 'notifications-outline' : 'calendar-outline'}
                size={13}
                color={overdue ? colors.danger : colors.textMuted}
              />
              <Text style={[styles.dueText, { color: overdue ? colors.danger : colors.textMuted }]}>
                {formatDueDate(task.dueDateTime)}
                {overdue ? ' · overdue' : ''}
              </Text>
            </View>
          ) : null}
        </View>
      </View>

      <Pressable
        onPress={onDelete}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel={`Delete task ${task.title}`}
        testID={`delete-${task.id}`}>
        <Ionicons name="trash-outline" size={20} color={colors.textMuted} />
      </Pressable>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  body: { flex: 1, gap: 6 },
  title: { fontSize: 16, fontWeight: '500' },
  completedTitle: { textDecorationLine: 'line-through' },
  meta: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  chip: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 },
  chipText: { fontSize: 12, fontWeight: '500' },
  due: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  dueText: { fontSize: 12 },
});
