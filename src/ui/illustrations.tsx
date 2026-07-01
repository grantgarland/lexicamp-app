// Educational infographics — react-native-svg ports of the onboarding prototype's
// science illustrations (onboarding/Onboarding.html). Reused by the Home "How Lexicamp
// works" education card now, and by the onboarding story screens when those are built.
// Each scales to its container width via a fixed-aspect frame.
import type { ReactNode } from 'react';
import { View } from 'react-native';
import Svg, { Circle, G, Line, Path, Rect, Text as SvgText } from 'react-native-svg';

function Frame({ w, h, children }: { w: number; h: number; children: ReactNode }) {
  return (
    <View style={{ width: '100%', maxWidth: w, aspectRatio: w / h, alignSelf: 'center' }}>
      <Svg width="100%" height="100%" viewBox={`0 0 ${w} ${h}`}>
        {children}
      </Svg>
    </View>
  );
}

/** ForgettingCurve — memory decay vs. timed reviews (spaced repetition). */
export function ForgettingCurve() {
  return (
    <Frame w={300} h={150}>
      {/* Grid */}
      <Line x1={32} y1={8} x2={32} y2={118} stroke="#eef1f3" strokeWidth={1.5} />
      <Line x1={32} y1={118} x2={292} y2={118} stroke="#eef1f3" strokeWidth={1.5} />
      <Line x1={32} y1={48} x2={292} y2={48} stroke="#eef1f3" strokeWidth={1} strokeDasharray="4,3" />
      <Line x1={32} y1={78} x2={292} y2={78} stroke="#eef1f3" strokeWidth={1} strokeDasharray="4,3" />
      {/* Without Lexicamp — pure decay */}
      <Path d="M32 14 C60 30 100 72 140 98 S 220 113 292 117" stroke="#c2cdd4" strokeWidth={1.5} fill="none" strokeDasharray="5,3" />
      {/* Lexicamp decay + reviews */}
      <Path d="M32 14 Q60 46 84 96" stroke="#3c7499" strokeWidth={2.2} fill="none" strokeLinecap="round" />
      <Line x1={84} y1={96} x2={84} y2={36} stroke="#2e7d52" strokeWidth={1.8} strokeDasharray="3,2" />
      <Path d="M84 36 Q112 62 140 90" stroke="#3c7499" strokeWidth={2.2} fill="none" strokeLinecap="round" />
      <Line x1={140} y1={90} x2={140} y2={28} stroke="#2e7d52" strokeWidth={1.8} strokeDasharray="3,2" />
      <Path d="M140 28 Q182 52 218 78" stroke="#3c7499" strokeWidth={2.2} fill="none" strokeLinecap="round" />
      <Line x1={218} y1={78} x2={218} y2={22} stroke="#2e7d52" strokeWidth={1.8} strokeDasharray="3,2" />
      <Path d="M218 22 Q254 38 292 52" stroke="#3c7499" strokeWidth={2.2} fill="none" strokeLinecap="round" />
      {/* Dots */}
      <Circle cx={84} cy={96} r={3.5} fill="#d1495b" />
      <Circle cx={84} cy={36} r={3.5} fill="#2e7d52" />
      <Circle cx={140} cy={90} r={3.5} fill="#d1495b" />
      <Circle cx={140} cy={28} r={3.5} fill="#2e7d52" />
      <Circle cx={218} cy={78} r={3.5} fill="#d1495b" />
      <Circle cx={218} cy={22} r={3.5} fill="#2e7d52" />
      {/* Axis labels */}
      <SvgText x={32} y={132} fill="#9aa8b2" fontSize={9} textAnchor="middle">Start</SvgText>
      <SvgText x={84} y={132} fill="#9aa8b2" fontSize={9} textAnchor="middle">Day 3</SvgText>
      <SvgText x={140} y={132} fill="#9aa8b2" fontSize={9} textAnchor="middle">Day 9</SvgText>
      <SvgText x={218} y={132} fill="#9aa8b2" fontSize={9} textAnchor="middle">Day 21</SvgText>
      <SvgText x={28} y={17} fill="#9aa8b2" fontSize={8.5} textAnchor="end">100%</SvgText>
      <SvgText x={28} y={80} fill="#9aa8b2" fontSize={8.5} textAnchor="end">50%</SvgText>
      {/* Legend */}
      <Line x1={38} y1={143} x2={56} y2={143} stroke="#c2cdd4" strokeWidth={1.5} strokeDasharray="4,3" />
      <SvgText x={59} y={146} fill="#9aa8b2" fontSize={8}>without reviews</SvgText>
      <Line x1={152} y1={143} x2={170} y2={143} stroke="#3c7499" strokeWidth={2} />
      <SvgText x={173} y={146} fill="#3c7499" fontSize={8}>with Lexicamp</SvgText>
    </Frame>
  );
}

/** IntervalTrack — reviews timed just before forgetting, spaced ever wider. */
export function IntervalTrack() {
  const baseY = 96;
  const pts = [
    { x: 40, label: 'learn', cy: 40 },
    { x: 92, label: '1 day', cy: 80 },
    { x: 160, label: '3 days', cy: 78 },
    { x: 256, label: '1 week', cy: 72 },
  ];
  return (
    <Frame w={300} h={150}>
      <Line x1={28} y1={baseY} x2={284} y2={baseY} stroke="#eef1f3" strokeWidth={1.5} />
      <Path
        d="M40 40 Q66 78 92 80 L92 44 Q126 76 160 78 L160 36 Q208 70 256 72 L256 30"
        fill="none"
        stroke="#3c7499"
        strokeWidth={2.2}
        strokeLinecap="round"
      />
      {pts.map((p, i) => (
        <G key={p.x}>
          <Line x1={p.x} y1={baseY} x2={p.x} y2={baseY - 8} stroke="#c2cdd4" strokeWidth={1.4} />
          {i === 0 ? (
            <Circle cx={p.x} cy={p.cy} r={4} fill="#3c7499" />
          ) : (
            <G>
              <Circle cx={p.x} cy={p.cy} r={6.5} fill="#2e7d52" />
              <Path d={`M${p.x - 3} ${p.cy} l2 2.5 l4 -5`} fill="none" stroke="white" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
            </G>
          )}
          <SvgText x={p.x} y={118} fill="#71808b" fontSize={8.5} textAnchor="middle">{p.label}</SvgText>
        </G>
      ))}
      <G stroke="#a0d0b3" strokeWidth={1.2}>
        <Line x1={40} y1={128} x2={92} y2={128} />
        <Line x1={92} y1={132} x2={160} y2={132} />
        <Line x1={160} y1={136} x2={256} y2={136} />
      </G>
      <SvgText x={150} y={148} fill="#9aa8b2" fontSize={9} textAnchor="middle">Intervals stretch wider as the word sticks</SvgText>
    </Frame>
  );
}

/** CardSorter — the scheduler pulling due words into today's study queue. */
export function CardSorter() {
  return (
    <Frame w={300} h={148}>
      {/* Stacked back cards */}
      <G rotation={-6} originX={151} originY={71}>
        <Rect x={98} y={34} width={106} height={74} rx={9} fill="#eef4f8" stroke="#aecde0" strokeWidth={1.5} />
      </G>
      <G rotation={-3} originX={149} originY={68}>
        <Rect x={96} y={31} width={106} height={74} rx={9} fill="#d7e6f0" stroke="#80b1cc" strokeWidth={1.5} />
      </G>
      {/* Front card */}
      <Rect x={94} y={26} width={110} height={76} rx={10} fill="white" stroke="#3c7499" strokeWidth={2.5} />
      <SvgText x={149} y={62} fill="#1f3d52" fontSize={18} textAnchor="middle" fontWeight="600">montaña</SvgText>
      <SvgText x={149} y={79} fill="#71808b" fontSize={11} textAnchor="middle">mountain · noun</SvgText>
      <Circle cx={192} cy={33} r={11} fill="#e87722" />
      <SvgText x={192} y={37.5} fill="white" fontSize={9} textAnchor="middle" fontWeight="700">★</SvgText>
      {/* Today badge */}
      <Rect x={12} y={46} width={64} height={40} rx={8} fill="#eef4f8" stroke="#aecde0" strokeWidth={1.2} />
      <SvgText x={44} y={64} fill="#3c7499" fontSize={22} textAnchor="middle" fontWeight="600">23</SvgText>
      <SvgText x={44} y={78} fill="#71808b" fontSize={7.5} textAnchor="middle">today</SvgText>
      {/* Arrow (explicit head — RN svg has no marker support) */}
      <Line x1={79} y1={66} x2={88} y2={66} stroke="#3c7499" strokeWidth={1.8} strokeLinecap="round" />
      <Path d="M86 62 L92 66 L86 70 Z" fill="#3c7499" />
      {/* Caption */}
      <SvgText x={149} y={122} fill="#9aa8b2" fontSize={9.5} textAnchor="middle">The algorithm picks your daily queue</SvgText>
      {/* Decorative sorted piles */}
      <G rotation={8} originX={234} originY={70}>
        <Rect x={218} y={60} width={32} height={20} rx={4} fill="#eaf3ed" stroke="#a0d0b3" strokeWidth={1} />
      </G>
      <G rotation={-5} originX={272} originY={78}>
        <Rect x={256} y={68} width={32} height={20} rx={4} fill="#fff5ed" stroke="#f7a855" strokeWidth={1} />
      </G>
    </Frame>
  );
}

/** DailyPractice — same total time, spaced out: consistent short sessions retain far
 *  more than one big cram. Two tracks (sessions → retention meter) make the contrast
 *  concrete. Original to Lexicamp (no onboarding equivalent). */
export function DailyPractice() {
  return (
    <Frame w={300} h={150}>
      {/* Row A — Cram */}
      <SvgText x={8} y={48} fill="#71808b" fontSize={11} fontWeight="700">Cram</SvgText>
      <Rect x={44} y={34} width={46} height={20} rx={5} fill="#f3d9dd" stroke="#d1495b" strokeWidth={1.5} />
      <SvgText x={67} y={66} fill="#9aa8b2" fontSize={7.5} textAnchor="middle">1 long session</SvgText>
      <Line x1={150} y1={44} x2={166} y2={44} stroke="#c2cdd4" strokeWidth={1.4} strokeLinecap="round" />
      <Path d="M164 40 L170 44 L164 48 Z" fill="#c2cdd4" />
      <SvgText x={230} y={31} fill="#d1495b" fontSize={8} textAnchor="middle">≈30% kept</SvgText>
      <Rect x={180} y={38} width={100} height={12} rx={6} fill="#eef1f3" />
      <Rect x={180} y={38} width={30} height={12} rx={6} fill="#d1495b" />
      {/* Row B — A little daily */}
      <SvgText x={8} y={102} fill="#71808b" fontSize={11} fontWeight="700">Daily</SvgText>
      {[44, 58, 72, 86, 100, 114].map((x) => (
        <Rect key={x} x={x} y={84} width={8} height={20} rx={2} fill="#dbeadd" stroke="#2e7d52" strokeWidth={1.2} />
      ))}
      <SvgText x={83} y={116} fill="#9aa8b2" fontSize={7.5} textAnchor="middle">6 short sessions</SvgText>
      <Line x1={150} y1={94} x2={166} y2={94} stroke="#c2cdd4" strokeWidth={1.4} strokeLinecap="round" />
      <Path d="M164 90 L170 94 L164 98 Z" fill="#c2cdd4" />
      <SvgText x={230} y={81} fill="#2e7d52" fontSize={8} textAnchor="middle">≈90% kept</SvgText>
      <Rect x={180} y={88} width={100} height={12} rx={6} fill="#eef1f3" />
      <Rect x={180} y={88} width={88} height={12} rx={6} fill="#2e7d52" />
      {/* Caption */}
      <SvgText x={150} y={140} fill="#9aa8b2" fontSize={9} textAnchor="middle">Same total time — spacing it out sticks</SvgText>
    </Frame>
  );
}

/** SummitScene — the ascent from Base Camp through the tiers to the Summit flag. */
export function SummitScene() {
  const markers = [
    { x: 74, y: 152, c: '#2e7d52' },
    { x: 116, y: 126, c: '#459a6b' },
    { x: 92, y: 100, c: '#2f5e7e' },
    { x: 140, y: 74, c: '#5491b5' },
    { x: 150, y: 40, c: '#e87722' },
  ];
  return (
    <Frame w={300} h={175}>
      <Rect x={0} y={0} width={300} height={175} rx={12} fill="#eef4f8" />
      <Path d="M0 165 L90 90 L150 130 L210 70 L300 150 L300 175 L0 175 Z" fill="#d7e6f0" />
      <Path d="M20 168 L150 32 L280 168 Z" fill="#cfe0ec" stroke="#80b1cc" strokeWidth={1.5} />
      <Path d="M150 32 L124 60 Q140 52 150 62 Q161 50 176 60 Z" fill="white" />
      <Path d="M74 152 Q60 134 116 126 Q150 120 92 100 Q60 86 140 74 Q156 68 150 40" fill="none" stroke="#5491b5" strokeWidth={1.8} strokeDasharray="4,3" />
      {markers.map((m) => (
        <Circle key={`${m.x}-${m.y}`} cx={m.x} cy={m.y} r={4.5} fill="white" stroke={m.c} strokeWidth={2} />
      ))}
      <Line x1={150} y1={40} x2={150} y2={16} stroke="#1f3d52" strokeWidth={1.8} />
      <Path d="M150 17 L168 22 L150 28 Z" fill="#e87722" />
      <Circle cx={150} cy={40} r={11} fill="#e87722" fillOpacity={0.12} />
    </Frame>
  );
}
