import { useRouter } from 'expo-router';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StyleSheet } from 'react-native-unistyles';

import { Button, Card, Text } from '@/ui';

// Temporary home — entry point into the component gallery during build-out.
// Replaced by the real Home screen in P4.
export default function Index() {
  const router = useRouter();
  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.center}>
        <Card elevated padding={24} style={styles.card}>
          <Text variant="display">Lexicamp</Text>
          <Text variant="caption" align="center">
            UI kit · P2 primitives
          </Text>
          <View style={styles.swatches}>
            <View style={[styles.swatch, styles.brand]} />
            <View style={[styles.swatch, styles.accent]} />
            <View style={[styles.swatch, styles.evergreen]} />
            <View style={[styles.swatch, styles.danger]} />
          </View>
          <Button title="Open kitchen sink" variant="pill" onPress={() => router.push('/kitchen-sink')} />
        </Card>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create((theme) => ({
  screen: { flex: 1, backgroundColor: theme.color.canvas },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: theme.space[6] },
  card: { alignItems: 'center', gap: theme.space[4] },
  swatches: { flexDirection: 'row', gap: theme.space[3] },
  swatch: { width: 44, height: 44, borderRadius: theme.radius.md },
  brand: { backgroundColor: theme.color.brand },
  accent: { backgroundColor: theme.color.accent },
  evergreen: { backgroundColor: theme.color.evergreen },
  danger: { backgroundColor: theme.color.danger },
}));
