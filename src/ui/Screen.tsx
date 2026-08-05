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
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

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
  const { theme } = useUnistyles();
  const has = (e: Edge) => edges.includes(e);
  return (
    <View style={[styles.safe, background != null && { backgroundColor: background }, style]}>
      <View
        // REMOUNT THE SCREEN BODY ON A LIGHT↔DARK FLIP (Casey, 2026-08-04).
        //
        // Unistyles applies theme changes by writing to native ShadowNodes, not
        // by re-rendering — so a node that is missing from its ShadowRegistry
        // never repaints, no matter how many times React renders it. Some nodes
        // are reliably missed (reproduced on the simulator: after a cold launch
        // in light, flipping to dark left "Tuesday, August 4" and the How-it-
        // works title rendering light-mode near-black ink on the dark canvas
        // while everything around them switched). That is why the workaround
        // everyone finds is "leave the screen and come back" — a REMOUNT
        // re-registers every node and re-applies styles from scratch.
        //
        // Keying on the theme name does exactly that, and does it here rather
        // than at the navigator so the navigation stack, route params and
        // history all survive: only the current screen's body is rebuilt. It
        // fires solely when the OS appearance actually changes, which is rare
        // and already a visible, full-screen repaint — so the remount is
        // invisible inside it.
        //
        // Cost, stated plainly: component state INSIDE a screen resets on that
        // flip (an open sheet closes, a half-typed search box clears). Accepted
        // over shipping a half-painted UI. Remove the key the day Unistyles
        // registers every node reliably — nothing else depends on it.
        key={theme.isDark ? 'dark' : 'light'}
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
