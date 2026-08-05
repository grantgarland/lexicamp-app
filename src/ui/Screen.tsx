// Screen — the standard screen frame for P4. Safe-area insets + canvas background +
// a centered max-width column so phone layouts don't stretch edge-to-edge on tablets
// / large Android / landscape. Put a ScrollView (or content) inside as children.
//
// Uses the `useSafeAreaInsets` HOOK (not the SafeAreaView component): the component
// does frame-based edge detection that under-reports the top inset inside full-screen
// modals (e.g. the quiz), letting content overflow into the status bar. The hook reads
// the per-screen inset context directly and is reliable everywhere.
import type { ReactNode } from 'react';
import { View, type ViewStyle } from 'react-native';
import { type Edge, useSafeAreaInsets } from 'react-native-safe-area-context';
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
  /** Style for the outer view. */
  style?: ViewStyle;
  /** Style for the centered inner column. */
  contentStyle?: ViewStyle;
}

export function Screen({ children, edges = ['top', 'bottom'], background, style, contentStyle }: ScreenProps) {
  const insets = useSafeAreaInsets();
  const has = (e: Edge) => edges.includes(e);
  return (
    <View style={[styles.safe, background != null && { backgroundColor: background }, style]}>
      <View
        style={[
          styles.inner,
          {
            paddingTop: has('top') ? insets.top : 0,
            paddingBottom: has('bottom') ? insets.bottom : 0,
            paddingLeft: has('left') ? insets.left : 0,
            paddingRight: has('right') ? insets.right : 0,
          },
          contentStyle,
        ]}
      >
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  safe: { flex: 1, backgroundColor: theme.color.canvas },
  inner: { flex: 1, width: '100%', maxWidth: SCREEN_MAX_WIDTH, alignSelf: 'center' },
}));
