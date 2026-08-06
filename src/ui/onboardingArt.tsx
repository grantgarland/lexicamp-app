// Onboarding art — the two vector graphics the first-run arc carries, both
// APPEARANCE-AWARE. They read the theme instead of hardcoding hex the way
// `illustrations.tsx` does: those were ported from the light-mode HTML
// prototype and go muddy on the dark canvas, and onboarding is the one place a
// user meets the app before they can change anything.
//
// Kept out of illustrations.tsx on purpose — that file is a set of pure static
// SVGs with no hooks, and these need `useUnistyles`.
import { View } from 'react-native';
import Svg, { Circle, Line, Polyline, SvgXml, Text as SvgText } from 'react-native-svg';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { BRAND_MARK_KNOCKOUT_XML } from './brandMark';
import { RawText } from './Text';

/** Fixed-aspect responsive frame (same contract as illustrations.tsx `Frame`). */
function Frame({ w, h, maxWidth, children }: { w: number; h: number; maxWidth?: number; children: React.ReactNode }) {
  return (
    <View style={{ width: '100%', maxWidth: maxWidth ?? w, aspectRatio: w / h, alignSelf: 'center' }}>
      <Svg width="100%" height="100%" viewBox={`0 0 ${w} ${h}`}>
        {children}
      </Svg>
    </View>
  );
}

// ── Curve model ──────────────────────────────────────────────────────────────
// Both series are PLOTTED FROM ONE DECAY FUNCTION rather than hand-drawn paths.
// The first hand-drawn pass had the reviewed line dipping BELOW the un-reviewed
// one before its first review, which is impossible — nothing has happened yet,
// so the two are the same word. Generating them removes the whole class of
// "looks plausible, says something false" bug from an infographic whose entire
// job is to be believed.
//
// R(t) = e^(−t/S), the standard exponential retention curve; a review restores
// R to 1 and multiplies S (this is the shape FSRS produces, not the numbers —
// real stability comes from domain/fsrs.ts and depends on the user's answers).
const HORIZON = 21; // days on the x-axis
/** The half-remembered line the reviews cluster around. */
const REVIEW_THRESHOLD = 0.5;
/** Reviews, as (day, recall when it actually happened).
 *
 *  ⚠️ CONCEPTUAL, NOT THE SCHEDULER. `domain/fsrs.ts` runs
 *  `request_retention: 0.9`, so the algorithm aims far higher than this. What
 *  the graphic depicts is the human version of the same idea (Casey
 *  2026-08-05): a real person opens the app a bit early or a bit late, so their
 *  reviews land AROUND the half-forgotten mark rather than exactly on it — which
 *  is the intuition the beat is teaching. The scatter is deliberate; dots in a
 *  perfect row read as a machine, and the depths are kept inside 40–60% so the
 *  point ("you review near the middle of the curve") survives the wobble.
 *
 *  Stability per leg is DERIVED so decay reaches that recall exactly as the
 *  review arrives — that is the model: remembering multiplies stability, so a
 *  similar dip buys ever more days. */
const REVIEWS: { day: number; recall: number }[] = [
  { day: 1, recall: 0.58 },
  { day: 4, recall: 0.43 },
  { day: 12, recall: 0.52 },
];
const LEGS = REVIEWS.map((r, i) => {
  const from = i === 0 ? 0 : REVIEWS[i - 1].day;
  return { from, to: r.day, s: (r.day - from) / -Math.log(r.recall) };
}).concat({
  // Tail leg: keeps going at the pace the last review earned, out to the horizon.
  from: REVIEWS[REVIEWS.length - 1].day,
  to: HORIZON,
  s: (HORIZON - REVIEWS[REVIEWS.length - 1].day) / -Math.log(0.55),
});
const retention = (elapsed: number, s: number) => Math.exp(-elapsed / s);

/** ForgettingCurve, onboarding edition — bigger and labelled, because on O-02 it
 *  IS the argument rather than a decoration beside two paragraphs.
 *
 *  Reads as two stories at a glance: the dashed line (no review) falls to
 *  nothing inside three weeks; the solid line is caught at each review — the
 *  drop marked, the recovery marked — and each fall is slower than the last. The
 *  50% guide is what makes "slower" legible rather than asserted.
 *
 *  The x-axis is √days, not days: on a linear axis the first three reviews all
 *  pile up in the leftmost fifth and the interesting part is unreadable. */
export function ForgettingCurveInfo({ maxWidth = 420 }: { maxWidth?: number }) {
  const { theme } = useUnistyles();
  const { color } = theme;
  const axis = color.borderStrong;
  const grid = color.divider;
  const label = color.textFaint;
  const decay = color.textFaint;
  const line = color.brand;
  const up = color.success;
  const drop = color.danger;

  // Plot box inside the 340×200 viewBox.
  const L = 40, R = 330, T = 18, B = 150;
  const X = (day: number) => L + Math.sqrt(day / HORIZON) * (R - L);
  const Y = (r: number) => B - r * (B - T);
  /** Sample one leg into a polyline point list. */
  const leg = (from: number, to: number, s: number) =>
    Array.from({ length: 26 }, (_, i) => {
      const t = from + ((to - from) * i) / 25;
      return `${X(t).toFixed(1)},${Y(retention(t - from, s)).toFixed(1)}`;
    }).join(' ');

  // Never reviewed: one leg, all the way out.
  const never = leg(0, HORIZON, LEGS[0].s);
  // Reviews land at the boundary between legs — `slice(1)`'s index i is the
  // PREVIOUS leg, which is the one whose decay says how far recall had fallen.
  const reviews = LEGS.slice(1).map((l, i) => ({
    day: l.from,
    fallen: retention(l.from - LEGS[i].from, LEGS[i].s),
  }));

  return (
    <Frame w={340} h={200} maxWidth={maxWidth}>
      {/* Guides */}
      <Line x1={L} y1={T} x2={L} y2={B} stroke={axis} strokeWidth={1.5} />
      <Line x1={L} y1={B} x2={R} y2={B} stroke={axis} strokeWidth={1.5} />
      <Line x1={L} y1={Y(1)} x2={R} y2={Y(1)} stroke={grid} strokeWidth={1} strokeDasharray="4,4" />
      {/* The half-forgotten line the reviews cluster around. Drawn in the drop
          colour and labelled, so the scattered red dots read as "near this",
          not as three unrelated depths. */}
      <Line x1={L} y1={Y(REVIEW_THRESHOLD)} x2={R} y2={Y(REVIEW_THRESHOLD)} stroke={drop} strokeWidth={1} strokeDasharray="2,3" opacity={0.7} />

      {/* Without review — pure decay to near zero. */}
      <Polyline points={never} stroke={decay} strokeWidth={1.6} strokeDasharray="5,4" fill="none" strokeLinecap="round" />

      {/* With Lexicamp — the same decay, interrupted. */}
      {LEGS.map((l) => (
        <Polyline key={l.from} points={leg(l.from, l.to, l.s)} stroke={line} strokeWidth={2.6} fill="none" strokeLinecap="round" />
      ))}
      {reviews.map((r) => (
        <Line key={r.day} x1={X(r.day)} y1={Y(r.fallen)} x2={X(r.day)} y2={Y(1)} stroke={up} strokeWidth={1.8} strokeDasharray="3,3" />
      ))}
      {reviews.map((r) => (
        <Circle key={`d${r.day}`} cx={X(r.day)} cy={Y(r.fallen)} r={4} fill={drop} />
      ))}
      {reviews.map((r) => (
        <Circle key={`u${r.day}`} cx={X(r.day)} cy={Y(1)} r={4} fill={up} />
      ))}

      {/* Scales */}
      <SvgText x={L - 6} y={Y(1) + 4} fill={label} fontSize={9} textAnchor="end">100%</SvgText>
      <SvgText x={L - 6} y={Y(REVIEW_THRESHOLD) + 4} fill={drop} fontSize={9} textAnchor="end">50%</SvgText>
      {/* Below the threshold line, not above it: above is where the reviewed
          curve lives and the label collided with it. */}
      <SvgText x={R} y={Y(REVIEW_THRESHOLD) + 13} fill={drop} fontSize={9} textAnchor="end" opacity={0.9}>half forgotten</SvgText>
      {[0, 1, 4, 12, HORIZON].map((d) => (
        <SvgText key={d} x={X(d)} y={B + 15} fill={label} fontSize={9.5} textAnchor="middle">
          {d === 0 ? 'Day 0' : `${d}`}
        </SvgText>
      ))}

      {/* Legend */}
      <Line x1={L} y1={B + 36} x2={L + 20} y2={B + 36} stroke={decay} strokeWidth={1.6} strokeDasharray="5,4" />
      <SvgText x={L + 26} y={B + 39} fill={label} fontSize={9.5}>without review</SvgText>
      <Line x1={188} y1={B + 36} x2={208} y2={B + 36} stroke={line} strokeWidth={2.6} />
      <SvgText x={214} y={B + 39} fill={line} fontSize={9.5}>with Lexicamp</SvgText>
    </Frame>
  );
}

/** ReminderPreview — what a Lexicamp reminder looks like when it lands, drawn as
 *  a notification card rather than photographed.
 *
 *  WHY DRAWN: an OS banner screenshot cannot be captured on a simulator at all —
 *  `requestPushPermission` bails on `!Device.isDevice` (push.ts), so iOS never
 *  authorizes the app and never displays a pushed alert. Drawing it also keeps
 *  the card appearance-aware and localizable, which a PNG of an English banner
 *  would not be.
 *
 *  The copy is the REAL reminder copy — `push_send_reminders` sends "Your words
 *  are ready" + "<n> words are ready for review" (see the one-reminder-per-device
 *  migration). If that text changes, change it here: an onboarding screen
 *  promising a notification the app doesn't send is a broken promise. */
export function ReminderPreview({ title, body, now }: { title: string; body: string; now: string }) {
  return (
    <View style={previewStyles.card}>
      <View style={previewStyles.icon}>
        <SvgXml xml={BRAND_MARK_KNOCKOUT_XML} width={26} height={26} />
      </View>
      <View style={previewStyles.copy}>
        <View style={previewStyles.headerRow}>
          <RawText style={previewStyles.title} numberOfLines={1}>{title}</RawText>
          <RawText style={previewStyles.now}>{now}</RawText>
        </View>
        <RawText style={previewStyles.body} numberOfLines={2}>{body}</RawText>
      </View>
    </View>
  );
}

const previewStyles = StyleSheet.create((theme) => ({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    alignSelf: 'stretch',
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 20,
    borderWidth: theme.borderWidth.thin,
    borderColor: theme.color.border,
    backgroundColor: theme.color.surfaceCard,
    boxShadow: theme.shadow.md,
  },
  icon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: theme.color.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  copy: { flex: 1 },
  headerRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 },
  title: { flex: 1, fontFamily: theme.fonts.sans.semibold, fontSize: 14, color: theme.color.textStrong },
  now: { fontFamily: theme.fonts.sans.regular, fontSize: 12, color: theme.color.textFaint },
  body: { fontFamily: theme.fonts.sans.regular, fontSize: 13, lineHeight: 18, color: theme.color.textBody, marginTop: 1 },
}));

/** MountainRoute — the welcome screen's quiet horizon: a ridge line with the
 *  route drawn up it and a camp marked at each of the five mastery tiers, the
 *  summit in accent. Deliberately low-contrast; it sits under the wordmark and
 *  must never compete with it. */
export function MountainRoute({ maxWidth = 300 }: { maxWidth?: number }) {
  const { theme } = useUnistyles();
  const { color } = theme;
  const ridge = color.borderStrong;
  const route = color.brand;
  const camp = color.brand;

  // Camps sit ON the route polyline below, low → high (Base Camp … Summit), and
  // the last one lands exactly on the front ridge's high point — a summit
  // marker floating above its own mountain is the one thing that would make
  // this read as decoration rather than a route.
  const CAMPS: [number, number][] = [
    [36, 110],
    [78, 84],
    [114, 82],
    [150, 52],
    [186, 20],
  ];
  return (
    <Frame w={300} h={130} maxWidth={maxWidth}>
      {/* Back ridge — a second, fainter peak for depth. */}
      <Polyline
        points="0,124 58,72 96,96 150,44 206,88 262,52 300,124"
        fill="none"
        stroke={ridge}
        strokeWidth={1.2}
        strokeLinejoin="round"
        opacity={0.3}
      />
      {/* Front ridge: a shoulder, a saddle, then the summit. */}
      <Polyline
        points="8,124 70,66 104,92 186,20 250,76 296,124"
        fill="none"
        stroke={ridge}
        strokeWidth={1.8}
        strokeLinejoin="round"
        opacity={0.75}
      />
      {/* The route: base → summit, inside the silhouette so it reads as a path
          ON the face rather than a line over the sky. */}
      <Polyline
        points="36,110 78,84 114,82 150,52 186,20"
        fill="none"
        stroke={route}
        strokeWidth={1.6}
        strokeDasharray="4,5"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={0.8}
      />
      {CAMPS.map(([x, y], i) => {
        const summit = i === CAMPS.length - 1;
        return (
          <Circle
            key={x}
            cx={x}
            cy={y}
            r={summit ? 4.5 : 3}
            fill={summit ? color.accent : camp}
            opacity={summit ? 0.95 : 0.55}
          />
        );
      })}
    </Frame>
  );
}
