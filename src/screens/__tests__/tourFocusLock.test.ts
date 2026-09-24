// Guard: nothing under the walkthrough may take keyboard focus.
//
// Found on build 12 (2026-09-24): step w3 opens Search, whose input autoFocused.
// The tour's overlay blocks touches but not the keyboard, so the keyboard rose
// over the tooltip's Next/Back/Skip — the tour's ONLY exits, the backdrop being
// inert by design — and typing replaced the demo word w3b spotlights. The screen
// looked frozen. Nothing fails loudly when this regresses, so it is pinned here.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = (rel: string) => readFileSync(join(__dirname, '..', '..', '..', rel), 'utf8');

describe('walkthrough focus lock', () => {
  const search = src('src/screens/SearchScreen.tsx');

  it('locks the search field while the tour demo is on screen', () => {
    expect(search).toMatch(/<SearchBar [^>]*locked=\{tourSearchDemo\}/);
    expect(search).toMatch(/autoFocus=\{!locked\}/);
    expect(search).toMatch(/editable=\{!locked\}/);
  });

  it('never leaves a bare autoFocus on the search input', () => {
    expect(search).not.toMatch(/^\s*autoFocus\s*$/m);
  });

  it('blurs and dismisses the keyboard if focus arrived before the lock', () => {
    expect(search).toMatch(/if \(!locked\) return;\s*inputRef\.current\?\.blur\(\);\s*Keyboard\.dismiss\(\);/);
  });

  it('keeps the quiz answer field from auto-focusing under the tour', () => {
    expect(src('src/screens/QuizScreen.tsx')).toMatch(/autoFocus=\{!tourActive\}/);
  });
});
