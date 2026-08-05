// forecastGeometry — the plot math behind `ForecastChart`, kept in its own module.
//
// Deliberately import-free, for the same reason as `revealOffset`: the chart
// pulls in react-native-unistyles (and through it nitro-modules), which needs a
// native binary and dies at import time under jest. Splitting the pure part out
// means the geometry that can silently draw the marker in the wrong place stays
// testable with zero mocks.

export interface ForecastChartPoint {
  day: number;
  mastered: number;
}

/**
 * The day at which the DRAWN line first reaches `value` — where the eye sees the
 * curve cross the threshold — or null if it never does inside the plot.
 *
 * This is how the camp marker is positioned (2026-08-04). It used to be placed
 * from the model's own crossing day, which is a different quantity: the model
 * answers "when do you reach 100 words", the curve answers "where does this
 * stroke cross this dashed line", and any disagreement between them left the dot
 * hanging in open space above or below the intersection it was supposed to mark.
 * Solving the rendered polyline for the rendered threshold makes the dot land on
 * BOTH lines by construction — it cannot drift, whatever the model does.
 *
 * (The model disagreement that exposed this was real and is fixed too — see
 * `daysToReach` in domain/projection.ts. This function is the belt to that
 * fix's braces: the marker is a statement about the drawing, so it is measured
 * from the drawing.)
 *
 * Linear interpolation matches how the path joins its samples. If the line ever
 * gains a smoothing curve (monotone, cardinal), this is the function that has to
 * learn it — the marker follows whatever is actually stroked.
 */
export function dayAtValue(points: readonly ForecastChartPoint[], value: number): number | null {
  if (points.length === 0) return null;
  const first = points[0]!;
  // Already at or above the threshold when the plot starts: the crossing is the
  // left edge, not somewhere off-canvas behind it.
  if (first.mastered >= value) return first.day;

  for (let i = 1; i < points.length; i += 1) {
    const b = points[i]!;
    if (b.mastered < value) continue;
    const a = points[i - 1]!;
    const rise = b.mastered - a.mastered;
    // Vertical step (or a duplicate x): the crossing is at that sample.
    if (rise <= 0) return b.day;
    return a.day + ((value - a.mastered) / rise) * (b.day - a.day);
  }
  return null; // the curve never gets there inside the horizon
}
