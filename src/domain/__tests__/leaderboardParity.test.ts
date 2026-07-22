// Drift tripwire for the leaderboard "mastered" threshold (spec 20 §4.4,
// 20-C). `get_leaderboard`'s server-side aggregate hardcodes the mastery
// stability threshold (it cannot import domain/derive.ts); this suite parses
// the applied migration mirror and asserts the hardcoded threshold — and the
// `reps > 0` co-condition — match MASTERY_STABILITY exactly, same
// change-both-or-neither pattern as captureGateParity/username parity.
import * as fs from 'fs';
import * as path from 'path';

import { MASTERY_STABILITY } from '../derive';

// The dev-preview lens is the LATEST live definition of get_leaderboard —
// pin against it, not the earlier (superseded) migrations.
const MIGRATION = path.join(__dirname, '../../../supabase/migrations/20260722231215_leaderboard_dev_preview.sql');

describe('SQL ↔ TS parity (leaderboard mastery threshold)', () => {
  const sql = fs.readFileSync(MIGRATION, 'utf8');

  it('hardcodes the SAME stability threshold as domain/derive.ts', () => {
    // Appears twice: once in the `agg` CTE's count filter, once in the
    // (currently redundant but defensively duplicated) HAVING clause.
    const matches = [...sql.matchAll(/stability >= (\d+)/g)].map((m) => Number(m[1]));
    expect(matches.length).toBeGreaterThan(0);
    for (const threshold of matches) expect(threshold).toBe(MASTERY_STABILITY);
  });

  it('requires reps > 0 alongside the stability threshold (matches derive.ts wordLifecycle/homeSnapshot)', () => {
    expect(sql).toContain('s.reps > 0 and s.stability >=');
  });

  it('never filters on cards.suspended (07-17c: archived cards still count toward mastered)', () => {
    expect(sql).not.toMatch(/not\s+c\.suspended/);
    expect(sql).not.toMatch(/c\.suspended\s*=\s*false/);
  });

  it('excludes dev accounts from a REAL caller\'s aggregate (dev-preview lens: a dev caller can see other dev accounts, a real caller never can)', () => {
    expect(sql).toContain('not p.is_dev');
    expect(sql).toContain('v_caller_is_dev');
  });

  it('never selects email, display_name, or a bare user id as an output column', () => {
    // Guards the "never expose PII" contract in §4.4 — the RETURNS TABLE
    // and final SELECT must stay limited to rank/username/lang_code/mastered/is_self.
    // Scoped past the header comment (which mentions "user_id"-shaped identifiers
    // like `agg_user_id` in prose) to the actual function definition.
    const fnStart = sql.indexOf('create or replace function public.get_leaderboard');
    const body = sql.slice(fnStart);
    const returnsTable = body.slice(body.indexOf('returns table'), body.indexOf('language plpgsql'));
    expect(returnsTable).not.toMatch(/email|display_name|user_id/);
  });
});
