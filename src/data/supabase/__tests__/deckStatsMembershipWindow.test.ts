// Drift tripwire for get_deck_stats's MEMBERSHIP WINDOW (03, RPC inventory).
//
// Deck counters are a property of the deck, not of the words in it. The RPC
// joins review_logs through deck_cards, and the join MUST be bounded by
// deck_cards.created_at — the moment the card joined the deck. Without that
// bound, a deck assembled from already-studied words inherits their entire
// review history the instant it is created: a deck made today out of 4 studied
// words opened on "REVIEWS 22 / LAST REVIEWED 4 days ago" (Casey, 2026-08-13).
//
// The rule lives in SQL, which jest cannot execute, so this suite pins the
// applied migration's text the same change-both-or-neither way
// captureGateParity/leaderboardParity pin theirs. The behavioural half of the
// rule ("a new deck reads 0 / Never") is asserted implementation-agnostically
// in data/__tests__/dataSourceContract.ts.
import * as fs from 'fs';
import * as path from 'path';

const MIGRATIONS = path.join(__dirname, '../../../../supabase/migrations');

/** The LATEST migration defining get_deck_stats — later files supersede earlier
 *  ones, so pinning a hardcoded filename would silently stop guarding the live
 *  definition the next time the function is rewritten. */
function latestDeckStatsDefinition(): { file: string; body: string } {
  const files = fs
    .readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith('.sql'))
    .sort(); // timestamp-prefixed → lexicographic order is chronological
  for (const file of [...files].reverse()) {
    const sql = fs.readFileSync(path.join(MIGRATIONS, file), 'utf8');
    // The function body between `create or replace function get_deck_stats` and
    // the closing `$function$;`.
    const m = sql.match(/create or replace function public\.get_deck_stats\(\)[\s\S]*?\$function\$([\s\S]*?)\$function\$;/);
    if (m) return { file, body: m[1]! };
  }
  throw new Error('no migration defines public.get_deck_stats()');
}

describe('get_deck_stats counts reviews from the membership window only', () => {
  const { file, body } = latestDeckStatsDefinition();

  it('is defined by a migration in the repo (the live function is not repo-only drift)', () => {
    expect(file).toBeTruthy();
    expect(body).toContain('review_logs');
    expect(body).toContain('deck_cards');
  });

  it('bounds the review_logs join by deck_cards.created_at', () => {
    // The whole bug in one predicate. Normalised for whitespace/newlines so a
    // reformat of the SQL does not read as a regression.
    const flat = body.replace(/--[^\n]*/g, ' ').replace(/\s+/g, ' ');
    expect(flat).toMatch(/r\.reviewed_at\s*>=?\s*dc\.created_at/);
  });

  it('applies the window to BOTH counters — reviews and last_reviewed_at', () => {
    // They come from one join, so one predicate covers both; this asserts the
    // shape that makes that true (a single `left join public.review_logs`
    // feeding both count() and max()), so a future rewrite that splits them
    // cannot bound only one and leave "Last reviewed" reading pre-membership.
    const flat = body.replace(/--[^\n]*/g, ' ').replace(/\s+/g, ' ');
    expect(flat.match(/join public\.review_logs/g)?.length).toBe(1);
    expect(flat).toMatch(/count\(r\.id\)/);
    expect(flat).toMatch(/max\(r\.reviewed_at\)/);
  });

  it('still scopes every join to the calling user', () => {
    // The window must not have displaced the ownership predicates that make a
    // SECURITY DEFINER read safe.
    const flat = body.replace(/--[^\n]*/g, ' ').replace(/\s+/g, ' ');
    expect(flat).toMatch(/dc\.user_id = auth\.uid\(\)/);
    expect(flat).toMatch(/r\.user_id = auth\.uid\(\)/);
    expect(flat).toMatch(/dk\.user_id = auth\.uid\(\)/);
  });
});
