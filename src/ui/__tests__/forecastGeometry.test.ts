// The camp marker on Progress → Projection must sit exactly where the drawn
// curve meets the drawn threshold line (2026-08-04, Casey screenshot).
//
// It was originally placed at the model's crossing DAY with the threshold's own
// y value, then (first pass) at the model's day with the curve's y. Both are
// answers to a different question than "where do these two lines meet", and both
// left the dot in open space whenever the model and the plotted curve disagreed
// — which they did, materially: at 20 mastered with 80 words maturing, the model
// said day 40 while the curve crossed 100 words on day 26.6 and stood at 158 by
// day 40. Solving the RENDERED polyline for the RENDERED threshold is the only
// formulation that cannot drift, whatever the model does.
//
// Import from '../forecastGeometry', NOT from '../ForecastChart' — same split as
// revealOffset/ScrollIntoView: the component pulls in unistyles (and nitro), which
// needs a native binary and dies at import time under jest.
import { dayAtValue, type ForecastChartPoint } from '../forecastGeometry';

const pts = (...xs: [number, number][]): ForecastChartPoint[] => xs.map(([day, mastered]) => ({ day, mastered }));

describe('dayAtValue', () => {
  it('finds the crossing between two samples', () => {
    // 60 → 200 over 10 days; 100 is 2/7 of the way up ⇒ day 2.857…
    expect(dayAtValue(pts([0, 60], [10, 200]), 100)).toBeCloseTo(20 / 7, 6);
  });

  it('lands exactly on a sample that equals the threshold', () => {
    expect(dayAtValue(pts([0, 60], [5, 100], [10, 200]), 100)).toBe(5);
  });

  it('takes the FIRST crossing, not a later one', () => {
    // A curve that dips back under the line must still mark where it first got
    // there — that is the day the user reaches the camp.
    expect(dayAtValue(pts([0, 60], [5, 120], [10, 90], [15, 130]), 100)).toBeCloseTo(5 * (40 / 60), 6);
  });

  it('reports day 0 when the plot already starts at or above the line', () => {
    expect(dayAtValue(pts([0, 100], [10, 200]), 100)).toBe(0);
    expect(dayAtValue(pts([0, 140], [10, 200]), 100)).toBe(0);
  });

  it('returns null when the curve never reaches the line', () => {
    // No dot rather than a dot clamped to the edge, which would claim a crossing
    // that does not happen inside the plot.
    expect(dayAtValue(pts([0, 10], [10, 80]), 100)).toBeNull();
    expect(dayAtValue([], 100)).toBeNull();
  });

  it('puts the marker ON the threshold, not where the model pointed — THE bug', () => {
    // The screenshot case, in one assertion. The model said day 40; the curve is
    // at 158 words by then, so a dot at x=40 floats far above the 100-word line
    // it is meant to mark. The crossing is day 26.6.
    const curve = pts([0, 20], [10, 55], [20, 85], [30, 115], [40, 158]);
    const day = dayAtValue(curve, 100)!;
    expect(day).toBeGreaterThan(20);
    expect(day).toBeLessThan(30);
    expect(day).not.toBe(40);
  });

  it('survives a flat or backward segment at the crossing', () => {
    expect(dayAtValue(pts([0, 60], [5, 100], [5, 100], [10, 200]), 100)).toBe(5);
    expect(dayAtValue(pts([0, 100], [5, 100]), 100)).toBe(0);
  });
});
