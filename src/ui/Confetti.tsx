// Confetti — a one-shot celebratory fall (milestone screens). Pure Reanimated: each
// piece animates once from above the top to below the bottom with rotation + a little
// horizontal drift, staggered by a random delay. `pointerEvents: none` so it never
// blocks the CTA. Fixed `count` → a stable number of hooks.
import { useEffect, useMemo } from 'react';
import { StyleSheet as RNStyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';

interface Piece {
  id: number;
  xPct: number;
  size: number;
  circle: boolean;
  color: string;
  delay: number; // s
  duration: number; // s
  drift: number; // px
}

function makePieces(colors: string[], count: number): Piece[] {
  return Array.from({ length: count }, (_, i) => ({
    id: i,
    xPct: Math.round(Math.random() * 100),
    size: 6 + Math.round(Math.random() * 6),
    circle: Math.random() < 0.4,
    color: colors[i % colors.length],
    delay: Math.random() * 1.6,
    duration: 1.9 + Math.random() * 1.1,
    drift: (Math.random() - 0.5) * 60,
  }));
}

function ConfettiPiece({ piece, fallH }: { piece: Piece; fallH: number }) {
  const p = useSharedValue(0);
  useEffect(() => {
    p.value = withDelay(piece.delay * 1000, withTiming(1, { duration: piece.duration * 1000, easing: Easing.in(Easing.quad) }));
  }, [p, piece.delay, piece.duration]);

  const animStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: -16 + p.value * fallH },
      { translateX: Math.sin(p.value * Math.PI * 2) * piece.drift },
      { rotate: `${p.value * 800}deg` },
    ],
    opacity: p.value === 0 ? 0 : p.value < 0.85 ? 1 : 1 - (p.value - 0.85) / 0.15,
  }));

  const w = piece.circle ? piece.size : piece.size * 0.7;
  const h = piece.circle ? piece.size : piece.size * 1.6;
  return (
    <Animated.View
      style={[
        { position: 'absolute', left: `${piece.xPct}%`, top: 0, width: w, height: h, borderRadius: piece.circle ? piece.size / 2 : 2, backgroundColor: piece.color },
        animStyle,
      ]}
    />
  );
}

export interface ConfettiProps {
  colors: string[];
  count?: number;
}

export function Confetti({ colors, count = 32 }: ConfettiProps) {
  const { height } = useWindowDimensions();
  const pieces = useMemo(() => makePieces(colors, count), [colors, count]);
  return (
    <View pointerEvents="none" style={RNStyleSheet.absoluteFill}>
      {pieces.map((pc) => (
        <ConfettiPiece key={pc.id} piece={pc} fallH={height + 40} />
      ))}
    </View>
  );
}
