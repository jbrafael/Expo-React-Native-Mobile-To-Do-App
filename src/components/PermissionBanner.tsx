import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import { useColors } from '@/theme/colors';

/** Shown when notification permission is denied; the app keeps working without reminders. */
export function PermissionBanner() {
  const colors = useColors();
  return (
    <View style={[styles.banner, { backgroundColor: colors.warningBg }]}>
      <Text style={[styles.text, { color: colors.warning }]}>
        Notifications are off, so due-date reminders won&apos;t be delivered. Tasks are still saved.
      </Text>
      <Pressable onPress={() => Linking.openSettings()} accessibilityRole="button" hitSlop={8}>
        <Text style={[styles.link, { color: colors.warning }]}>Open settings</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: { borderRadius: 10, padding: 12, gap: 6 },
  text: { fontSize: 13 },
  link: { fontSize: 13, fontWeight: '700' },
});
