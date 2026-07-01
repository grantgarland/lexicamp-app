// SearchBar — the shared search field (Word List, deck word-pickers, etc.). A rounded
// slate field with a leading magnifier + trailing clear; pass `onFilter` to append the
// filter/sort button (omit it for a plain search, e.g. the deck word-picker).
import { Pressable, TextInput, View, type ViewStyle } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { useTranslation } from '@/i18n';
import { IconSearch, IconSliders, IconX } from './icons';

export interface SearchBarProps {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  /** Provide to show the trailing filter/sort button. */
  onFilter?: () => void;
  filterActive?: boolean;
  autoFocus?: boolean;
  style?: ViewStyle;
}

export function SearchBar({ value, onChange, placeholder, onFilter, filterActive = false, autoFocus, style }: SearchBarProps) {
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  return (
    <View style={[styles.row, style]}>
      <View style={styles.field}>
        <IconSearch size={16} color={theme.color.textMuted} />
        <TextInput
          value={value}
          onChangeText={onChange}
          placeholder={placeholder}
          placeholderTextColor={theme.color.textMuted}
          autoCapitalize="none"
          autoCorrect={false}
          autoFocus={autoFocus}
          style={[styles.input, { fontFamily: theme.fonts.sans.regular, color: theme.color.textBody }]}
        />
        {value !== '' && (
          <Pressable onPress={() => onChange('')} accessibilityRole="button" accessibilityLabel={t('common.clear')} hitSlop={8}>
            <IconX size={14} color={theme.color.textMuted} />
          </Pressable>
        )}
      </View>
      {onFilter != null && (
        <Pressable
          onPress={onFilter}
          accessibilityRole="button"
          accessibilityLabel={t('common.filter')}
          style={[styles.filterBtn, { backgroundColor: filterActive ? theme.color.brand : theme.palette.slate[100] }]}
        >
          <IconSliders size={16} color={filterActive ? '#fff' : theme.color.textMuted} />
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  row: { flexDirection: 'row', gap: 8 },
  field: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: theme.palette.slate[100], borderRadius: 10, paddingHorizontal: 12, height: 40 },
  input: { flex: 1, fontSize: 15, padding: 0 },
  filterBtn: { width: 40, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
}));
