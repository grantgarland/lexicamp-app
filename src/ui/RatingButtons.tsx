// RatingButtons — the quiz recall self-grade (Again / Almost / Got it), ported
// from Quiz's RATING_CONFIG. Full-width 56px rows, label + sublabel, press scale.
import { Pressable, View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { Text } from './Text';

export type Rating = 'again' | 'almost' | 'got_it';

const ITEMS: { id: Rating; label: string; sublabel: string }[] = [
  { id: 'again', label: 'Again', sublabel: 'No recall' },
  { id: 'almost', label: 'Almost', sublabel: 'Partial recall' },
  { id: 'got_it', label: 'Got it', sublabel: 'Clean recall' },
];

export interface RatingButtonsProps {
  onRate: (rating: Rating) => void;
  prompt?: string;
}

export function RatingButtons({ onRate, prompt = 'How well did you recall it?' }: RatingButtonsProps) {
  const { theme } = useUnistyles();
  const { color: c, palette: p } = theme;

  const cfg: Record<Rating, { bg: string; border: string; text: string; sub: string }> = {
    again: { bg: p.slate[100], border: p.slate[200], text: c.textBody, sub: c.textMuted },
    almost: { bg: p.blue[50], border: p.blue[200], text: p.blue[700], sub: c.textMuted },
    got_it: { bg: p.green[500], border: 'transparent', text: '#fff', sub: 'rgba(255, 255, 255, 0.7)' },
  };

  return (
    <View style={styles.wrap}>
      <Text style={styles.prompt}>{prompt}</Text>
      {ITEMS.map((r) => {
        const s = cfg[r.id];
        return (
          <Pressable
            key={r.id}
            accessibilityRole="button"
            onPress={() => onRate(r.id)}
            style={({ pressed }) => [
              styles.btn,
              { backgroundColor: s.bg, borderColor: s.border },
              pressed && styles.pressed,
            ]}
          >
            <Text style={[styles.label, { color: s.text }]}>{r.label}</Text>
            <Text style={[styles.sub, { color: s.sub }]}>{r.sublabel}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  wrap: { gap: 8 },
  prompt: {
    fontFamily: theme.fonts.sans.bold,
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    color: theme.color.textMuted,
    textAlign: 'center',
    marginBottom: 2,
  },
  btn: {
    minHeight: 56,
    borderWidth: theme.borderWidth.base,
    borderRadius: theme.radius.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
  },
  pressed: { transform: [{ scale: 0.98 }] },
  label: { fontFamily: theme.fonts.sans.bold, fontSize: 16 },
  sub: { fontFamily: theme.fonts.sans.regular, fontSize: 12 },
}));
