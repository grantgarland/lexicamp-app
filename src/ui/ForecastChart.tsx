// ForecastChart — the mastery forecast curve on Progress → Projection.
//
// ONE series (projected mastered words over time), so per the charting rules
// there is no legend: the card title names the series. The line carries the
// TIER's hue (the colour of the camp being climbed toward); every piece of text
// wears a text token, never the series colour. Axes are recessive — a single
// hairline baseline, no gridlines — and the only annotation is the camp
// threshold, which is the one thing a user actually reads off it.
//
// GEOMETRY NOTE (2026-07-30 fix): this used a fixed 300-unit viewBox with
// `preserveAspectRatio="none"`, which stretches the x-axis to fill the card and
// scales x and y by DIFFERENT factors. That squashed the whole plot and turned
// the crossing marker into a visible ellipse. The chart now measures its own
// width via onLayout and draws in real pixels — 1 unit is 1 point on both axes,
// so circles are round and the curve keeps its true slope.
import { useMemo, useState } from 'react';
import { View, type LayoutChangeEvent, type ViewStyle } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Path, Stop, Line as SvgLine, Text as SvgText } from 'react-native-svg';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { RawText as Text } from './Text';

export interface ForecastChartPoint {
  day: number;
  mastered: number;
}

export interface ForecastChartThreshold {
  /** Y value of the dashed line (a camp's mastered-word target). */
  value: number;
  /** Short label drawn ON the line, e.g. "100 words" — the y-axis identifier. */
  axisLabel: string;
  /** Longer caption under the plot, e.g. "Adv. Base Camp · in 7 months". */
  caption: string;
  /** X position (days) where the curve crosses it; null hides the marker dot. */
  day: number | null;
}

export interface ForecastChartProps {
  points: ForecastChartPoint[];
  horizonDays: number;
  /** Series hue — pass the target tier's colour so the chart matches its card. */
  color: string;
  threshold?: ForecastChartThreshold | null;
  /** x-axis end caps, already localized (e.g. "Today" / "18 months"). */
  startLabel: string;
  endLabel: string;
  /** Spoken summary — the accessible equivalent of reading the plot. */
  accessibilityLabel: string;
  height?: number;
  style?: ViewStyle;
}

// Room at the top for the curve's head, and on the right so the axis label and
// the final point don't collide with the card edge.
const PAD_L = 2;
const PAD_R = 6;
const PAD_T = 18;
const PAD_B = 6;
const AXIS_LABEL_SIZE = 10;

export function ForecastChart({
  points,
  horizonDays,
  color,
  threshold,
  startLabel,
  endLabel,
  accessibilityLabel,
  height = 148,
  style,
}: ForecastChartProps) {
  const { theme } = useUnistyles();
  const [width, setWidth] = useState(0);
  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);

  const geom = useMemo(() => {
    if (width <= 0 || points.length < 2 || horizonDays <= 0) return null;
    // The y-scale must contain the threshold, otherwise the camp line sits
    // off-canvas exactly when the user has not reached it — i.e. always, at the
    // moment they most want to see it.
    const maxY = Math.max(points[points.length - 1]!.mastered, threshold?.value ?? 0, 1);
    const minY = points[0]!.mastered;
    const spanY = Math.max(maxY - minY, 1);

    const x = (day: number) => PAD_L + (day / horizonDays) * (width - PAD_L - PAD_R);
    const y = (v: number) => height - PAD_B - ((v - minY) / spanY) * (height - PAD_T - PAD_B);

    const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.day).toFixed(2)},${y(p.mastered).toFixed(2)}`).join(' ');
    const area = `${line} L${x(horizonDays).toFixed(2)},${(height - PAD_B).toFixed(2)} L${x(0).toFixed(2)},${(height - PAD_B).toFixed(2)} Z`;

    const cross =
      threshold?.day != null && threshold.day >= 0 && threshold.day <= horizonDays
        ? { cx: x(threshold.day), cy: y(threshold.value) }
        : null;

    const thresholdY = threshold != null ? y(threshold.value) : null;
    return { line, area, thresholdY, cross, x, y };
  }, [width, points, horizonDays, threshold, height]);

  return (
    <View testID="forecastChart" style={style} onLayout={onLayout} accessibilityRole="image" accessibilityLabel={accessibilityLabel}>
      {geom != null && (
        <Svg width={width} height={height}>
          <Defs>
            <LinearGradient id="forecastFill" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={color} stopOpacity={0.22} />
              <Stop offset="1" stopColor={color} stopOpacity={0.02} />
            </LinearGradient>
          </Defs>

          <Path d={geom.area} fill="url(#forecastFill)" />

          {/* Camp threshold — dashed so it never competes with the data line,
              and labelled with its own y value so the line means something on
              its own instead of being an unexplained rule across the plot. */}
          {geom.thresholdY != null && (
            <>
              <SvgLine
                x1={PAD_L}
                y1={geom.thresholdY}
                x2={width - PAD_R}
                y2={geom.thresholdY}
                stroke={theme.color.borderStrong}
                strokeWidth={1}
                strokeDasharray="4 4"
              />
              <SvgText
                testID="forecastAxisLabel"
                x={PAD_L}
                // Sits just above its own line; clamped so it never clips off
                // the top when the threshold is near the peak.
                y={Math.max(AXIS_LABEL_SIZE, geom.thresholdY - 5)}
                fill={theme.color.textMuted}
                fontSize={AXIS_LABEL_SIZE}
                fontWeight="600"
              >
                {threshold!.axisLabel}
              </SvgText>
            </>
          )}

          <Path d={geom.line} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />

          {/* Crossing marker, ringed in the surface colour so it stays legible
              where it sits on the line. Round, now that x and y share a scale. */}
          {geom.cross != null && (
            <Circle cx={geom.cross.cx} cy={geom.cross.cy} r={4.5} fill={color} stroke={theme.color.surfaceCard} strokeWidth={2} />
          )}

          {/* Recessive baseline — no gridlines. */}
          <SvgLine x1={PAD_L} y1={height - PAD_B} x2={width - PAD_R} y2={height - PAD_B} stroke={theme.color.divider} strokeWidth={1} />
        </Svg>
      )}

      {/* Selective direct labels only: the threshold caption and the two x-axis
          caps. Never a number on every point. */}
      {threshold != null && <Text style={styles.thresholdLabel}>{threshold.caption}</Text>}
      <View style={styles.axisRow}>
        <Text style={styles.axisLabel}>{startLabel}</Text>
        <Text style={styles.axisLabel}>{endLabel}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => {
  const { color, fonts } = theme;
  return {
    thresholdLabel: { fontFamily: fonts.sans.semibold, fontSize: 12, color: color.textStrong, marginTop: 10 },
    axisRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 2 },
    axisLabel: { fontFamily: fonts.sans.regular, fontSize: 11, color: color.textMuted },
  };
});
