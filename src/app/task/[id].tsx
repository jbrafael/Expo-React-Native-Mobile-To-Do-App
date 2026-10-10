import { usePreventRemove } from '@react-navigation/native';
import { router, Stack, useLocalSearchParams, useNavigation } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';

import { Chip } from '@/components/Chip';
import { DueDateField } from '@/components/DueDateField';
import type { TaskInput } from '@/models/types';
import { describeReminderOutcome, useTaskStore } from '@/state/TaskStore';
import { useColors } from '@/theme/colors';

interface FormState {
  title: string;
  description: string;
  completed: boolean;
  due: Date | null;
  categoryId: number | null;
}

const EMPTY_FORM: FormState = {
  title: '',
  description: '',
  completed: false,
  due: null,
  categoryId: null,
};

function sameForm(a: FormState, b: FormState): boolean {
  return (
    a.title === b.title &&
    a.description === b.description &&
    a.completed === b.completed &&
    a.categoryId === b.categoryId &&
    (a.due?.getTime() ?? null) === (b.due?.getTime() ?? null)
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Screen B — task editor. Route: `/task/new` creates, `/task/<id>` edits.
 * Only the id travels through navigation; the task itself is loaded from SQLite.
 */
export default function TaskEditorScreen() {
  const colors = useColors();
  const navigation = useNavigation();
  const params = useLocalSearchParams<{ id: string }>();
  const isNew = params.id === 'new';
  const taskId = isNew ? null : Number(params.id);
  const { categories, loadTask, createTask, updateTask, deleteTask } = useTaskStore();

  const [initial, setInitial] = useState<FormState>(EMPTY_FORM);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [loading, setLoading] = useState(!isNew);
  const [notFound, setNotFound] = useState(false);
  const [titleError, setTitleError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Set once the user has saved/deleted/discarded, so leaving is no longer blocked.
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    if (isNew) return;
    if (taskId === null || !Number.isInteger(taskId)) {
      setNotFound(true);
      setLoading(false);
      return;
    }
    let cancelled = false;
    loadTask(taskId)
      .then((task) => {
        if (cancelled) return;
        if (!task) {
          setNotFound(true);
          return;
        }
        const loaded: FormState = {
          title: task.title,
          description: task.description ?? '',
          completed: task.completed,
          due: task.dueDateTime ? new Date(task.dueDateTime) : null,
          categoryId: task.categoryId,
        };
        setInitial(loaded);
        setForm(loaded);
      })
      .catch((e) => !cancelled && Alert.alert('Could not load task', errorMessage(e)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [isNew, taskId, loadTask]);

  // If the selected category is deleted elsewhere, clear it.
  useEffect(() => {
    if (form.categoryId !== null && !categories.some((c) => c.id === form.categoryId)) {
      setForm((f) => ({ ...f, categoryId: null }));
    }
  }, [categories, form.categoryId]);

  const dirty = useMemo(() => !sameForm(form, initial), [form, initial]);

  // Guard against losing unsaved input (header back, Android back button, swipe back).
  usePreventRemove(dirty && !leaving, ({ data }) => {
    Alert.alert('Discard changes?', 'You have unsaved changes to this task.', [
      { text: 'Keep editing', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: () => navigation.dispatch(data.action) },
    ]);
  });

  useEffect(() => {
    if (leaving) router.back();
  }, [leaving]);

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const save = async () => {
    if (form.title.trim().length === 0) {
      setTitleError('Title is required.');
      return;
    }
    setTitleError(null);
    setSaving(true);
    const input: TaskInput = {
      title: form.title,
      description: form.description,
      completed: form.completed,
      dueDateTime: form.due ? form.due.toISOString() : null,
      categoryId: form.categoryId,
    };
    try {
      const { reminder } =
        taskId === null ? await createTask(input) : await updateTask(taskId, input);
      const message = describeReminderOutcome(reminder);
      if (message && reminder.status !== 'scheduled') {
        Alert.alert('Saved', message);
      }
      setLeaving(true);
    } catch (e) {
      Alert.alert('Could not save task', errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = () => {
    if (taskId === null) return;
    Alert.alert('Delete task?', 'This task will be permanently deleted.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteTask(taskId);
            setLeaving(true);
          } catch (e) {
            Alert.alert('Could not delete task', errorMessage(e));
          }
        },
      },
    ]);
  };

  const header = (
    <Stack.Screen
      options={{
        title: isNew ? 'New task' : 'Edit task',
        headerRight: () =>
          loading || notFound ? null : (
            <Pressable onPress={save} disabled={saving} accessibilityRole="button" hitSlop={10}>
              <Text style={[styles.headerButton, { color: colors.primary }]}>Save</Text>
            </Pressable>
          ),
      }}
    />
  );

  if (loading) {
    return (
      <View style={styles.center}>
        {header}
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (notFound) {
    return (
      <View style={styles.center}>
        {header}
        <Text style={{ color: colors.text }}>This task no longer exists.</Text>
      </View>
    );
  }

  const inputStyle = [
    styles.input,
    { color: colors.text, backgroundColor: colors.surface, borderColor: colors.border },
  ];

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={100}>
      {header}
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.field}>
          <Text style={[styles.label, { color: colors.text }]}>Title *</Text>
          <TextInput
            testID="title-input"
            value={form.title}
            onChangeText={(text) => {
              update('title', text);
              if (titleError && text.trim()) setTitleError(null);
            }}
            placeholder="What needs to be done?"
            placeholderTextColor={colors.textMuted}
            style={[inputStyle, titleError ? { borderColor: colors.danger } : null]}
            autoFocus={isNew}
            maxLength={200}
            returnKeyType="next"
          />
          {titleError ? (
            <Text testID="title-error" style={[styles.error, { color: colors.danger }]}>
              {titleError}
            </Text>
          ) : null}
        </View>

        <View style={styles.field}>
          <Text style={[styles.label, { color: colors.text }]}>Description</Text>
          <TextInput
            testID="description-input"
            value={form.description}
            onChangeText={(text) => update('description', text)}
            placeholder="Optional details"
            placeholderTextColor={colors.textMuted}
            style={[inputStyle, styles.multiline]}
            multiline
            textAlignVertical="top"
          />
        </View>

        <View style={styles.field}>
          <Text style={[styles.label, { color: colors.text }]}>Category</Text>
          <View style={styles.chips}>
            <Chip
              label="None"
              selected={form.categoryId === null}
              onPress={() => update('categoryId', null)}
            />
            {categories.map((c) => (
              <Chip
                key={c.id}
                label={c.name}
                selected={form.categoryId === c.id}
                onPress={() => update('categoryId', c.id)}
              />
            ))}
          </View>
          {categories.length === 0 ? (
            <Text style={[styles.hint, { color: colors.textMuted }]}>
              No categories yet — create them from the tag icon on the task list.
            </Text>
          ) : null}
        </View>

        <DueDateField value={form.due} onChange={(due) => update('due', due)} />

        <View style={styles.switchRow}>
          <Text style={[styles.label, { color: colors.text }]}>Completed</Text>
          <Switch
            testID="completed-switch"
            value={form.completed}
            onValueChange={(v) => update('completed', v)}
          />
        </View>

        <View style={styles.actions}>
          <Pressable
            testID="save-button"
            onPress={save}
            disabled={saving}
            accessibilityRole="button"
            style={[styles.primaryButton, { backgroundColor: colors.primary, opacity: saving ? 0.6 : 1 }]}>
            <Text style={[styles.primaryButtonText, { color: colors.primaryText }]}>
              {saving ? 'Saving…' : 'Save'}
            </Text>
          </Pressable>
          <Pressable
            onPress={() => router.back()}
            accessibilityRole="button"
            style={[styles.secondaryButton, { borderColor: colors.border }]}>
            <Text style={{ color: colors.text, fontWeight: '600' }}>Cancel</Text>
          </Pressable>
          {!isNew ? (
            <Pressable onPress={confirmDelete} accessibilityRole="button" style={styles.deleteButton}>
              <Text style={{ color: colors.danger, fontWeight: '600' }}>Delete task</Text>
            </Pressable>
          ) : null}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  content: { padding: 16, gap: 20, paddingBottom: 48 },
  field: { gap: 8 },
  label: { fontSize: 15, fontWeight: '500' },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16 },
  multiline: { minHeight: 90 },
  error: { fontSize: 13 },
  hint: { fontSize: 13 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  actions: { gap: 12, marginTop: 8 },
  primaryButton: { borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  primaryButtonText: { fontSize: 16, fontWeight: '600' },
  secondaryButton: { borderRadius: 12, paddingVertical: 14, alignItems: 'center', borderWidth: 1 },
  deleteButton: { paddingVertical: 14, alignItems: 'center' },
  headerButton: { fontSize: 16, fontWeight: '600' },
});
