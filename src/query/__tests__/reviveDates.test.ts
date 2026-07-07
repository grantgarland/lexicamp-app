// Regression: the persisted query cache is plain JSON, so a cold-launch rehydrate
// used to hand derive.ts stringified dates → `dueAt.getTime()` "undefined is not a
// function". reviveDates is the JSON.parse reviver that turns them back into Dates.
import { reviveDates } from '../reviveDates';

const roundTrip = <T>(value: T): T => JSON.parse(JSON.stringify(value), reviveDates);

describe('reviveDates', () => {
  it('revives every known date field to a real Date after a JSON round-trip', () => {
    const payload = {
      cards: [{ id: 'c1', createdAt: new Date('2026-07-01T12:00:00.000Z') }],
      states: [{ cardId: 'c1', dueAt: new Date('2026-07-07T00:00:00.000Z'), lastReviewAt: new Date('2026-07-05T09:00:00.000Z') }],
      entitlement: { currentPeriodEnd: new Date('2026-08-01T00:00:00.000Z') },
    };
    const out = roundTrip(payload);
    expect(out.cards[0].createdAt).toBeInstanceOf(Date);
    expect(out.states[0].dueAt).toBeInstanceOf(Date);
    expect(out.states[0].dueAt.getTime()).toBe(payload.states[0].dueAt.getTime());
    expect(out.states[0].lastReviewAt).toBeInstanceOf(Date);
    expect(out.entitlement.currentPeriodEnd).toBeInstanceOf(Date);
  });

  it('leaves null date fields as null (lastReviewAt / currentPeriodEnd)', () => {
    const out = roundTrip({ states: [{ dueAt: new Date(), lastReviewAt: null }], entitlement: { currentPeriodEnd: null } });
    expect(out.states[0].lastReviewAt).toBeNull();
    expect(out.entitlement.currentPeriodEnd).toBeNull();
  });

  it('does not touch non-date string fields', () => {
    const out = roundTrip({ id: 'abc', word: '2026-07-07', displayName: 'Casey' });
    expect(out.id).toBe('abc');
    expect(typeof out.word).toBe('string'); // a date-looking value under a non-date key stays a string
    expect(out.displayName).toBe('Casey');
  });
});
