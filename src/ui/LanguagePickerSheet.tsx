// LanguagePickerSheet — shared searchable language picker used by both onboarding
// (target-language step) and settings (Edit Profile → learning language). Rows show
// the English name with the native endonym beneath (e.g. Arabic · العربية) and search
// matches either name or the code. Sources its list from the `@/constants/languages`
// registry; callers pass a pre-filtered `languages` set (defaults to all translatable).
import { useMemo, useState } from 'react';
import { ScrollView } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';

import { type Language, TRANSLATABLE_LANGUAGES } from '@/constants';
import { useTranslation } from '@/i18n';

import { EmptyState } from './EmptyState';
import { IconCheck } from './icons';
import { Input } from './Input';
import { ListItem } from './List';
import { Sheet } from './Sheet';

export interface LanguagePickerSheetProps {
  visible: boolean;
  /** Currently selected code (checkmarked). */
  current: string;
  onSelect: (code: string) => void;
  onClose: () => void;
  title: string;
  searchPlaceholder: string;
  /** Languages to offer. Defaults to the full translatable set. */
  languages?: Language[];
}

export function LanguagePickerSheet({
  visible,
  current,
  onSelect,
  onClose,
  title,
  searchPlaceholder,
  languages = TRANSLATABLE_LANGUAGES,
}: LanguagePickerSheetProps) {
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  const [q, setQ] = useState('');
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (needle === '') return languages;
    return languages.filter(
      (l) =>
        l.name.toLowerCase().includes(needle) ||
        l.nativeName.toLowerCase().includes(needle) ||
        l.code.toLowerCase().includes(needle),
    );
  }, [q, languages]);

  return (
    <Sheet visible={visible} onClose={onClose} title={title}>
      <Input placeholder={searchPlaceholder} value={q} onChangeText={setQ} autoCapitalize="none" />
      <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        {/* A filter matching nothing used to render an empty ScrollView — 360px of
            blank under the input, with no way to tell a no-match from a hung sheet. */}
        {rows.length === 0 && <EmptyState title={t('langPicker.noMatchTitle')} body={t('langPicker.noMatchBody')} />}
        {rows.map((l, i) => (
          <ListItem
            key={l.code}
            title={l.name}
            subtitle={l.nativeName}
            onPress={() => onSelect(l.code)}
            trailing={current.toLowerCase() === l.code.toLowerCase() ? <IconCheck size={16} color={theme.color.brand} /> : undefined}
            last={i === rows.length - 1}
          />
        ))}
      </ScrollView>
    </Sheet>
  );
}

const styles = {
  scroll: { maxHeight: 360, marginTop: 6 },
} as const;
