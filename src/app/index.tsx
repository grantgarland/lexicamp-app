import { Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StyleSheet } from 'react-native-unistyles';

// P1 smoke screen — proves the Unistyles theme + generated tokens resolve on
// device. Replaced by the real Home screen in P4.
export default function Index() {
  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.card}>
        <Text style={styles.title}>Lexicamp</Text>
        <Text style={styles.body}>Unistyles theme wired · P1 tokens resolving.</Text>
        <View style={styles.swatches}>
          <View style={[styles.swatch, styles.brand]} />
          <View style={[styles.swatch, styles.accent]} />
          <View style={[styles.swatch, styles.evergreen]} />
          <View style={[styles.swatch, styles.danger]} />
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create((theme) => ({
  screen: {
    flex: 1,
    backgroundColor: theme.color.canvas,
    alignItems: 'center',
    justifyContent: 'center',
    padding: theme.space[6],
  },
  card: {
    alignItems: 'center',
    gap: theme.space[4],
    padding: theme.space[6],
    backgroundColor: theme.color.surfaceCard,
    borderRadius: theme.radius.lg,
    borderWidth: theme.borderWidth.thin,
    borderColor: theme.color.border,
    boxShadow: theme.shadow.md,
  },
  title: {
    fontFamily: theme.family.serif, // Spectral — proves the serif loaded
    fontSize: theme.size.xl,
    color: theme.color.textStrong,
  },
  body: {
    fontFamily: theme.family.sans, // Plus Jakarta Sans — proves the sans loaded
    fontSize: theme.size.sm,
    color: theme.color.textMuted,
    textAlign: 'center',
  },
  swatches: { flexDirection: 'row', gap: theme.space[3] },
  swatch: { width: 44, height: 44, borderRadius: theme.radius.md },
  brand: { backgroundColor: theme.color.brand },
  accent: { backgroundColor: theme.color.accent },
  evergreen: { backgroundColor: theme.color.evergreen },
  danger: { backgroundColor: theme.color.danger },
}));
