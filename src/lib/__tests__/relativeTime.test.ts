// dueLabel precision (Casey bug, 2026-07-17): the quiz results tooltip prints
// exact strength days ("grew to 18 days") while dueLabel rounded 14+ days to
// weeks ("in 3 weeks") — side by side the two read as a scheduling conflict.
// The cutoff moved to 28: exact day counts up to four weeks, weeks beyond.
import i18n from '@/i18n';
import { dueLabel, dueLabelShort } from '../relativeTime';

const t = i18n.t.bind(i18n);
const inDays = (d: number) => new Date(Date.now() + d * 24 * 60 * 60 * 1000);

describe('dueLabel days-vs-weeks cutoff', () => {
  it('18 days out reads as exact days, not "in 3 weeks"', () => {
    expect(dueLabel(inDays(18), t)).toBe('in 18 days');
  });

  it('27 days is still exact; 28+ switches to weeks', () => {
    expect(dueLabel(inDays(27), t)).toBe('in 27 days');
    expect(dueLabel(inDays(28), t)).toBe('in 4 weeks');
    expect(dueLabel(inDays(35), t)).toBe('in 5 weeks');
  });

  it('near-term labels unchanged (Due now / Today / Tomorrow / short days)', () => {
    expect(dueLabel(inDays(-1), t)).toBe('Due now');
    expect(dueLabel(inDays(1), t)).toBe('Tomorrow');
    expect(dueLabel(inDays(6), t)).toBe('in 6 days');
  });

  it('dueLabelShort follows the same cutoff', () => {
    expect(dueLabelShort(inDays(18), t)).toBe('18 days');
    expect(dueLabelShort(inDays(28), t)).toBe('4 wks');
  });
});
