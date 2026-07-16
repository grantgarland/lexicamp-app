// snapQuizLength (18-session quiz-length ladder): persisted values from retired
// option sets must land on the nearest current rung (ties round DOWN).
import { QUIZ_LENGTH_DEFAULT, QUIZ_LENGTHS, snapQuizLength } from '../prefsStore';

describe('snapQuizLength', () => {
  test('ladder values pass through', () => {
    for (const v of QUIZ_LENGTHS) expect(snapQuizLength(v)).toBe(v);
  });
  test('retired options snap to the nearest rung (ties down)', () => {
    expect(snapQuizLength(60)).toBe(40); // tie 40/80 → down
    expect(snapQuizLength(100)).toBe(80);
    expect(snapQuizLength(25)).toBe(20);
  });
  test('garbage falls back to the default', () => {
    expect(snapQuizLength(undefined)).toBe(QUIZ_LENGTH_DEFAULT);
    expect(snapQuizLength('40')).toBe(QUIZ_LENGTH_DEFAULT);
    expect(snapQuizLength(Number.NaN)).toBe(QUIZ_LENGTH_DEFAULT);
  });
});
