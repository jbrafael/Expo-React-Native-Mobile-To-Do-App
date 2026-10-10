import DateTimePicker, {
  DateTimePickerAndroid,
  type DateTimePickerEvent,
} from '@react-native-community/datetimepicker';
import { Platform, Pressable, StyleSheet, Switch, Text, View } from 'react-native';

import { useColors } from '@/theme/colors';
import { combineDateAndTime, formatDateOnly, formatTimeOnly, nextFullHour } from '@/utils/dates';

interface DueDateFieldProps {
  value: Date | null;
  onChange: (value: Date | null) => void;
}

/**
 * Optional due date + time. Android opens the native date and time dialogs imperatively
 * (`DateTimePickerAndroid.open`); iOS renders compact inline pickers.
 */
export function DueDateField({ value, onChange }: DueDateFieldProps) {
  const colors = useColors();
  const isPast = value !== null && value.getTime() <= Date.now();

  const openAndroid = (mode: 'date' | 'time') => {
    const current = value ?? nextFullHour();
    DateTimePickerAndroid.open({
      value: current,
      mode,
      is24Hour: true,
      onChange: (event: DateTimePickerEvent, picked?: Date) => {
        if (event.type !== 'set' || !picked) return;
        onChange(mode === 'date' ? combineDateAndTime(picked, current) : combineDateAndTime(current, picked));
      },
    });
  };

  const onIosChange = (mode: 'date' | 'time') => (_: DateTimePickerEvent, picked?: Date) => {
    if (!picked || !value) return;
    onChange(mode === 'date' ? combineDateAndTime(picked, value) : combineDateAndTime(value, picked));
  };

  return (
    <View style={styles.container}>
      <View style={styles.toggleRow}>
        <Text style={[styles.label, { color: colors.text }]}>Due date & reminder</Text>
        <Switch
          testID="due-toggle"
          value={value !== null}
          onValueChange={(on) => onChange(on ? nextFullHour() : null)}
          accessibilityLabel="Set a due date"
        />
      </View>

      {value !== null && Platform.OS === 'android' ? (
        <View style={styles.buttons}>
          <Pressable
            onPress={() => openAndroid('date')}
            style={[styles.button, { borderColor: colors.border, backgroundColor: colors.surface }]}
            accessibilityRole="button"
            accessibilityLabel="Change due date">
            <Text style={{ color: colors.text }}>{formatDateOnly(value)}</Text>
          </Pressable>
          <Pressable
            onPress={() => openAndroid('time')}
            style={[styles.button, { borderColor: colors.border, backgroundColor: colors.surface }]}
            accessibilityRole="button"
            accessibilityLabel="Change due time">
            <Text style={{ color: colors.text }}>{formatTimeOnly(value)}</Text>
          </Pressable>
        </View>
      ) : null}

      {value !== null && Platform.OS === 'ios' ? (
        <View style={styles.buttons}>
          <DateTimePicker value={value} mode="date" display="compact" onChange={onIosChange('date')} />
          <DateTimePicker value={value} mode="time" display="compact" onChange={onIosChange('time')} />
        </View>
      ) : null}

      {isPast ? (
        <Text style={[styles.hint, { color: colors.warning }]}>
          This time is in the past — the task can be saved, but no reminder will be scheduled.
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 10 },
  toggleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  label: { fontSize: 15, fontWeight: '500' },
  buttons: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  button: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10, borderWidth: 1 },
  hint: { fontSize: 13 },
});
