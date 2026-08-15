// InlineNote — the quiet terminal line that replaces a control once there is
// nothing more to fetch ("No example sentence for this one").
//
// Not an empty STATE: it says one small thing is missing, not that the surface
// is. It stays deliberately un-illustrated and non-interactive — the server has
// cached the empty result, so there is nothing to retry and no button should
// come back.
//
// Existed twice with the same styling but different alignment, which was the
// only real difference and is now a prop.
import { StyleSheet } from 'react-native-unistyles';

import { RawText } from './Text';

export interface InlineNoteProps {
  children: string;
  /** 'center' where it replaces a centered button; 'left' under a section label. */
  align?: 'left' | 'center';
  testID?: string;
}

export function InlineNote({ children, align = 'left', testID }: InlineNoteProps) {
  return (
    <RawText style={[styles.note, align === 'center' ? styles.center : styles.left]} testID={testID}>
      {children}
    </RawText>
  );
}

const styles = StyleSheet.create((theme) => ({
  note: {
    fontFamily: theme.fonts.sans.regular,
    fontSize: 13,
    fontStyle: 'italic',
    color: theme.color.textMuted,
    lineHeight: 20,
  },
  // Sized to sit where the button was without shifting the card's rhythm.
  center: { textAlign: 'center', paddingVertical: 10 },
  left: { textAlign: 'left', paddingVertical: 4 },
}));
