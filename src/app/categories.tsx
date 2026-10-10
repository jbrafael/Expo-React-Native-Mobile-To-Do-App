import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import {
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import type { Category } from '@/models/types';
import { useTaskStore } from '@/state/TaskStore';
import { useColors } from '@/theme/colors';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Screen C — list, create, rename and delete categories. */
export default function CategoriesScreen() {
  const colors = useColors();
  const { categories, tasks, createCategory, renameCategory, deleteCategory, countTasksInCategory } =
    useTaskStore();
  const [newName, setNewName] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState('');
  const [editError, setEditError] = useState<string | null>(null);

  const usage = (id: number) => tasks.filter((t) => t.categoryId === id).length;

  const add = async () => {
    try {
      await createCategory(newName);
      setNewName('');
      setCreateError(null);
    } catch (e) {
      setCreateError(errorMessage(e));
    }
  };

  const startEdit = (category: Category) => {
    setEditingId(category.id);
    setEditName(category.name);
    setEditError(null);
  };

  const saveEdit = async () => {
    if (editingId === null) return;
    try {
      await renameCategory(editingId, editName);
      setEditingId(null);
      setEditError(null);
    } catch (e) {
      setEditError(errorMessage(e));
    }
  };

  const confirmDelete = async (category: Category) => {
    let count = 0;
    try {
      count = await countTasksInCategory(category.id);
    } catch {
      count = usage(category.id);
    }
    const detail =
      count > 0
        ? `${count} task${count === 1 ? '' : 's'} will be kept and become uncategorized.`
        : 'No tasks use this category.';
    Alert.alert(`Delete "${category.name}"?`, detail, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteCategory(category.id);
            if (editingId === category.id) setEditingId(null);
          } catch (e) {
            Alert.alert('Could not delete category', errorMessage(e));
          }
        },
      },
    ]);
  };

  const inputStyle = [
    styles.input,
    { color: colors.text, backgroundColor: colors.surface, borderColor: colors.border },
  ];

  return (
    <KeyboardAvoidingView
      style={[styles.flex, { backgroundColor: colors.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={100}>
      <View style={styles.addSection}>
        <View style={styles.addRow}>
          <TextInput
            testID="new-category-input"
            value={newName}
            onChangeText={(t) => {
              setNewName(t);
              if (createError) setCreateError(null);
            }}
            placeholder="New category name"
            placeholderTextColor={colors.textMuted}
            style={[inputStyle, styles.flex, createError ? { borderColor: colors.danger } : null]}
            onSubmitEditing={add}
            returnKeyType="done"
            maxLength={50}
          />
          <Pressable
            testID="add-category"
            onPress={add}
            accessibilityRole="button"
            style={[styles.addButton, { backgroundColor: colors.primary }]}>
            <Text style={{ color: colors.primaryText, fontWeight: '600' }}>Add</Text>
          </Pressable>
        </View>
        {createError ? (
          <Text style={[styles.error, { color: colors.danger }]}>{createError}</Text>
        ) : null}
      </View>

      <FlatList
        data={categories}
        keyExtractor={(c) => String(c.id)}
        contentContainerStyle={styles.list}
        keyboardShouldPersistTaps="handled"
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        ListEmptyComponent={
          <Text style={[styles.empty, { color: colors.textMuted }]}>
            No categories yet. Add one above to group your tasks.
          </Text>
        }
        renderItem={({ item }) => (
          <View style={[styles.row, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            {editingId === item.id ? (
              <View style={styles.editBlock}>
                <View style={styles.addRow}>
                  <TextInput
                    value={editName}
                    onChangeText={(t) => {
                      setEditName(t);
                      if (editError) setEditError(null);
                    }}
                    style={[inputStyle, styles.flex, editError ? { borderColor: colors.danger } : null]}
                    autoFocus
                    onSubmitEditing={saveEdit}
                    returnKeyType="done"
                    maxLength={50}
                  />
                  <Pressable onPress={saveEdit} accessibilityRole="button" hitSlop={8} accessibilityLabel="Save name">
                    <Ionicons name="checkmark" size={24} color={colors.success} />
                  </Pressable>
                  <Pressable
                    onPress={() => setEditingId(null)}
                    accessibilityRole="button"
                    hitSlop={8}
                    accessibilityLabel="Cancel rename">
                    <Ionicons name="close" size={24} color={colors.textMuted} />
                  </Pressable>
                </View>
                {editError ? (
                  <Text style={[styles.error, { color: colors.danger }]}>{editError}</Text>
                ) : null}
              </View>
            ) : (
              <>
                <View style={styles.flex}>
                  <Text style={[styles.name, { color: colors.text }]}>{item.name}</Text>
                  <Text style={[styles.count, { color: colors.textMuted }]}>
                    {usage(item.id)} task{usage(item.id) === 1 ? '' : 's'}
                  </Text>
                </View>
                <Pressable
                  onPress={() => startEdit(item)}
                  accessibilityRole="button"
                  accessibilityLabel={`Rename ${item.name}`}
                  hitSlop={8}>
                  <Ionicons name="create-outline" size={22} color={colors.primary} />
                </Pressable>
                <Pressable
                  onPress={() => confirmDelete(item)}
                  accessibilityRole="button"
                  accessibilityLabel={`Delete ${item.name}`}
                  hitSlop={8}>
                  <Ionicons name="trash-outline" size={22} color={colors.danger} />
                </Pressable>
              </>
            )}
          </View>
        )}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  addSection: { padding: 16, gap: 6 },
  addRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16 },
  addButton: { borderRadius: 10, paddingHorizontal: 18, paddingVertical: 12 },
  error: { fontSize: 13 },
  list: { paddingHorizontal: 16, paddingBottom: 32 },
  separator: { height: 10 },
  empty: { textAlign: 'center', marginTop: 32, fontSize: 15 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    padding: 14,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  editBlock: { flex: 1, gap: 6 },
  name: { fontSize: 16, fontWeight: '500' },
  count: { fontSize: 12, marginTop: 2 },
});
