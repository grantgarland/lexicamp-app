// Ghost — row silhouettes, in the two signals the app needs them.
//
// ONE shape definition, two meanings, switched by `animated`:
//
//   animated  → PULSING. Data is still arriving. (What `Skeleton` used to be.)
//   static    → CONFIRMED EMPTY. The shape is known; there is nothing to put in it.
//
// That distinction is load-bearing, not decorative. A pulse says "wait"; showing
// one over a board we KNOW is empty is a lie the user waits out. The leaderboard
// learned this the hard way (ProgressScreen, 2026-07-24) and hand-rolled a static
// copy of its own row to say it — this module generalises that fix so every
// surface can make the same claim without re-deriving the silhouette.
//
// Pair a static ghost with `EmptyOverlay` + `EmptyStateCard` to say WHY it's empty.
import { useEffect } from 'react';
import { type DimensionValue, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { StyleSheet } from 'react-native-unistyles';

/** Row silhouettes, each mirroring a real row so the empty shape reads as its own list. */
export type GhostVariant =
  | 'word' // WordRow — tier pill · target/native · due + reps
  | 'deck' // DeckRow — icon tile · name/count
  | 'leader'; // Progress leaderboard — rank · flag · name · mastered

export interface GhostRowsProps {
  variant?: GhostVariant;
  count?: number;
  /** Pulse (still loading) rather than sit still (confirmed empty). */
  animated?: boolean;
}

interface BlockProps {
  width?: DimensionValue;
  height: number;
  radius?: number;
}

// Static and pulsing blocks are SEPARATE components rather than one component
// with an `animated` branch: the pulse needs reanimated hooks, and a component
// that calls hooks conditionally violates the react-hooks rules this repo
// enforces. Choosing between two children is a render branch, not a hook branch.
function StaticBlock({ width = '100%', height, radius = 6 }: BlockProps) {
  return <View style={[styles.block, { width, height, borderRadius: radius }]} />;
}

function PulseBlock({ width = '100%', height, radius = 6 }: BlockProps) {
  const o = useSharedValue(0.5);
  useEffect(() => {
    o.value = withRepeat(withTiming(1, { duration: 850, easing: Easing.inOut(Easing.quad) }), -1, true);
  }, [o]);
  const anim = useAnimatedStyle(() => ({ opacity: o.value }));
  return <Animated.View style={[styles.block, { width, height, borderRadius: radius }, anim]} />;
}

/** A single placeholder block. */
export function GhostBlock({ animated = false, ...dims }: BlockProps & { animated?: boolean }) {
  return animated ? <PulseBlock {...dims} /> : <StaticBlock {...dims} />;
}

export function GhostRows({ variant = 'word', count = 8, animated = false }: GhostRowsProps) {
  const Block = animated ? PulseBlock : StaticBlock;
  return (
    // No accessibility props by design: an unlabeled View tree is not an
    // accessibility element (see src/test/a11yCollapse.ts), so this whole layer
    // is already silent to VoiceOver. `pointerEvents` is the caller's business —
    // EmptyOverlay sets it on the layer it owns.
    <View style={variant === 'leader' ? styles.leaderStack : undefined}>
      {Array.from({ length: count }, (_, i) => (
        <GhostRow key={i} variant={variant} Block={Block} />
      ))}
    </View>
  );
}

function GhostRow({ variant, Block }: { variant: GhostVariant; Block: (p: BlockProps) => React.ReactElement }) {
  if (variant === 'leader') {
    return (
      <View style={styles.leaderRow}>
        <Block width={28} height={28} radius={14} />
        <Block width={20} height={15} radius={3} />
        <View style={styles.body}>
          <Block height={12} radius={4} />
        </View>
        <Block width={40} height={12} radius={4} />
      </View>
    );
  }

  if (variant === 'deck') {
    return (
      <View style={styles.deckRow}>
        <Block width={40} height={40} radius={10} />
        <View style={styles.body}>
          <Block width="44%" height={14} />
          <View style={styles.gap} />
          <Block width="30%" height={11} />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.wordRow}>
      <Block width={34} height={18} radius={9} />
      <View style={styles.body}>
        <Block width="52%" height={14} />
        <View style={styles.gap} />
        <Block width="34%" height={11} />
      </View>
      <View style={styles.trailing}>
        <Block width={30} height={10} />
        <View style={styles.gapSm} />
        <Block width={22} height={9} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => {
  const { color } = theme;
  // `skeletonBase` over `border`: it is the token generated for exactly this and
  // it is tuned per scheme (#eef1f3 / #1f2a32), where `border` is a hairline
  // colour that reads too faint as a fill on the dark canvas.
  const divider = { borderBottomWidth: theme.borderWidth.thin, borderBottomColor: color.divider };
  return {
    block: { backgroundColor: color.skeletonBase },
    body: { flex: 1, minWidth: 0 },
    gap: { height: 6 },
    gapSm: { height: 4 },
    trailing: { alignItems: 'flex-end' },
    // Mirrors WordRow's face (ListItem row chrome + WordRow's divider).
    wordRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 13, backgroundColor: color.surfaceCard, ...divider },
    // Mirrors DeckRow's face — taller, with the 40px icon tile.
    deckRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 14, backgroundColor: color.surfaceCard, ...divider },
    // Mirrors the leaderboard's own card rows, which are gapped rather than divided.
    leaderStack: { gap: 8 },
    leaderRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      backgroundColor: color.surfaceCard,
      borderWidth: theme.borderWidth.thin,
      borderColor: color.border,
      borderRadius: theme.radius.md,
      paddingVertical: 10,
      paddingHorizontal: 12,
    },
  };
});
