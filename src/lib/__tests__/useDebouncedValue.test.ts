import { act, renderHook } from '@testing-library/react-native';

import { SEARCH_DEBOUNCE_MS, useDebouncedValue } from '@/lib/useDebouncedValue';

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

const tick = (ms: number) => act(() => { jest.advanceTimersByTime(ms); });

describe('useDebouncedValue', () => {
  it('returns the initial value immediately — no first-render blank', () => {
    const { result } = renderHook(() => useDebouncedValue('mountain'));
    expect(result.current).toBe('mountain');
  });

  it('holds the previous value until the window elapses', () => {
    const { result, rerender } = renderHook((p: { v: string }) => useDebouncedValue(p.v), { initialProps: { v: 'a' } });
    rerender({ v: 'ab' });
    expect(result.current).toBe('a');
    tick(SEARCH_DEBOUNCE_MS - 1);
    expect(result.current).toBe('a');
    tick(1);
    expect(result.current).toBe('ab');
  });

  it('settles ONCE for a burst of keystrokes, not once per key', () => {
    // The actual bug: "mountain" typed quickly flashed the skeleton per letter.
    const { result, rerender } = renderHook((p: { v: string }) => useDebouncedValue(p.v), { initialProps: { v: '' } });
    for (const v of ['m', 'mo', 'mou', 'moun', 'mount', 'mounta', 'mountai', 'mountain']) {
      rerender({ v });
      tick(20); // faster than the window — the timer keeps being reset
    }
    expect(result.current).toBe(''); // nothing has settled mid-burst
    tick(SEARCH_DEBOUNCE_MS);
    expect(result.current).toBe('mountain');
  });

  it('does not re-emit when a value changes and comes back within the window', () => {
    // Type a character and delete it: the settled value never moved, so the list
    // must not be told anything happened.
    const { result, rerender } = renderHook((p: { v: string }) => useDebouncedValue(p.v), { initialProps: { v: 'ru' } });
    rerender({ v: 'rus' });
    tick(50);
    rerender({ v: 'ru' });
    tick(SEARCH_DEBOUNCE_MS * 2);
    expect(result.current).toBe('ru');
  });

  it('settles a cleared field like any other value', () => {
    const { result, rerender } = renderHook((p: { v: string }) => useDebouncedValue(p.v), { initialProps: { v: 'книга' } });
    rerender({ v: '' });
    tick(SEARCH_DEBOUNCE_MS);
    expect(result.current).toBe('');
  });

  it('honours a custom delay', () => {
    const { result, rerender } = renderHook((p: { v: string }) => useDebouncedValue(p.v, 1000), { initialProps: { v: 'a' } });
    rerender({ v: 'b' });
    tick(999);
    expect(result.current).toBe('a');
    tick(1);
    expect(result.current).toBe('b');
  });
});
