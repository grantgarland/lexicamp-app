// Screen — the standard screen frame for P4. SafeArea insets + canvas background +
// a centered max-width column so phone layouts don't stretch edge-to-edge on tablets
// / large Android / landscape. Put a ScrollView (or content) inside as children.
import type { ReactNode } from 'react';
import { View, type ViewStyle } from 'react-native';
import { type Edge, SafeAreaView } from 'react-native-safe-area-context';
import { StyleSheet } from 'react-native-unistyles';

/** Content column cap (pt). Phones are narrower than this, so it only engages on
 *  tablets / large or rotated devices. */
export const SCREEN_MAX_WIDTH = 560;

export interface ScreenProps {
  children: ReactNode;
  /** Safe-area edges to inset (default top + bottom). */
  edges?: readonly Edge[];
  /** Override the canvas background. */
  background?: string;
  /** Style for the outer safe-area view. */
  style?: ViewStyle;
  /** Style for the centered inner column. */
  contentStyle?: ViewStyle;
}

export function Screen({ children, edges = ['top', 'bottom'], background, style, contentStyle }: ScreenProps) {
  return (
    <SafeAreaView style={[styles.safe, background != null && { backgroundColor: background }, style]} edges={edges}>
      <View style={[styles.inner, contentStyle]}>{children}</View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create((theme) => ({
  safe: { flex: 1, backgroundColor: theme.color.canvas },
  inner: { flex: 1, width: '100%', maxWidth: SCREEN_MAX_WIDTH, alignSelf: 'center' },
}));
