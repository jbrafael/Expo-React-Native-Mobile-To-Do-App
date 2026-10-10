import { useColorScheme } from 'react-native';

const light = {
  background: '#F6F7F9',
  surface: '#FFFFFF',
  text: '#111827',
  textMuted: '#6B7280',
  border: '#E5E7EB',
  primary: '#2563EB',
  primaryText: '#FFFFFF',
  danger: '#DC2626',
  success: '#16A34A',
  warning: '#B45309',
  warningBg: '#FEF3C7',
  chip: '#EEF2FF',
  chipText: '#3730A3',
};

export type Palette = typeof light;

const dark: Palette = {
  background: '#0B0F17',
  surface: '#151B26',
  text: '#F3F4F6',
  textMuted: '#9CA3AF',
  border: '#273041',
  primary: '#3B82F6',
  primaryText: '#FFFFFF',
  danger: '#F87171',
  success: '#4ADE80',
  warning: '#FBBF24',
  warningBg: '#3A2E0B',
  chip: '#1E2A4A',
  chipText: '#C7D2FE',
};

export function useColors(): Palette {
  return useColorScheme() === 'dark' ? dark : light;
}
