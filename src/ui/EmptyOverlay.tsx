// EmptyOverlay — an empty-state card floating over the shape of what would be there.
//
//   <EmptyOverlay ghost={<GhostRows variant="word" />}>
//     <EmptyStateCard illustration={<IllustWordCards />} title={…} body={…} />
//   </EmptyOverlay>
//
// Use it ONLY where the content genuinely repeats — lists of words, decks,
// leaderboard rows. The silhouettes are informative there: they tell the user
// what this surface is for before they've ever filled it.
//
// Do NOT reach for it on a one-off surface (a chart, a summary, a route ladder).
// A ghost of something that was never a list is noise, and the wider design
// system reserves ghost-behind-a-panel for the NETWORK error state — "your data
// is known, just unreachable". Overusing it here would blur "empty" into
// "failed to load", which is the one thing this pattern must not do.
import type { ReactNode } from 'react';
import { View, type ViewStyle } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

export interface EmptyOverlayProps {
  /** The silhouette layer — typically <GhostRows/>. Static, never pulsing. */
  ghost: ReactNode;
  /** The message, typically <EmptyStateCard/>. */
  children: ReactNode;
  style?: ViewStyle;
}

export function EmptyOverlay({ ghost, children, style }: EmptyOverlayProps) {
  return (
    <View style={[styles.wrap, style]}>
      {/* pointerEvents rather than a11y props: the ghost tree is unlabeled, so
          it is already invisible to VoiceOver (src/test/a11yCollapse.ts). This
          only stops it swallowing taps meant for the card. */}
      <View pointerEvents="none">{ghost}</View>
      <View style={styles.overlay} pointerEvents="box-none">
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create(() => ({
  // `overflow: hidden` so callers can pass a ghost count that OVERFILLS the pane
  // and let it clip. Sizing the count to the viewport instead leaves a hard edge
  // part-way down on tall devices — the silhouettes have to run off the bottom
  // like a real list would, or they read as a short list rather than an empty one.
  wrap: { position: 'relative', overflow: 'hidden' },
  overlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
}));
