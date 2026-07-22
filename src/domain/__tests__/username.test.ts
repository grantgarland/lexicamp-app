import * as fs from 'fs';
import * as path from 'path';

import {
  USERNAME_ADJECTIVES,
  USERNAME_MAX,
  USERNAME_MIN,
  USERNAME_NOUNS,
  USERNAME_PATTERN,
  USERNAME_RESERVED,
  decomposeUsername,
  formatUsername,
  generateUsernameCandidate,
  validateUsername,
} from '../username';

// SQL ↔ TS parity (capture-gate-parity pattern): the vocabulary lives in the
// `username_words` table; its seed rows in the applied migration mirror MUST
// match this module's lists. Change both or neither.
const MIGRATION = path.join(
  __dirname,
  '../../../supabase/migrations/20260722184525_username_change_policy.sql',
);

function sqlWords(source: string, kind: string): string[] {
  // Scope to the seed INSERTs — the table's CHECK constraint also contains the
  // literal ('adj','noun') pair and must not be parsed as a word.
  const seeds = source.slice(source.indexOf('insert into public.username_words'));
  return [...seeds.matchAll(new RegExp(`\\('${kind}','([a-z]+)'\\)`, 'g'))].map((m) => m[1]);
}

describe('SQL ↔ TS parity (username_words seeds)', () => {
  const sql = fs.readFileSync(MIGRATION, 'utf8');

  it('adjective seeds match the TS list', () => {
    expect(sqlWords(sql, 'adj')).toEqual([...USERNAME_ADJECTIVES]);
  });

  it('noun seeds match the TS list', () => {
    expect(sqlWords(sql, 'noun')).toEqual([...USERNAME_NOUNS]);
  });

  it('suffix rule matches (two digits, verbatim in the RPC)', () => {
    expect(sql).toContain("!~ '^[0-9]{2}$'");
  });
});

describe('validateUsername', () => {
  it('accepts a canonical generated name', () => {
    expect(validateUsername('fluent-marmot')).toEqual({
      ok: true,
      value: 'fluent-marmot',
    });
  });

  it('normalizes case + whitespace and returns the normalized value', () => {
    expect(validateUsername('  Fluent-Marmot ')).toEqual({
      ok: true,
      value: 'fluent-marmot',
    });
  });

  it.each([
    ['ab', 'too_short'],
    ['a'.repeat(USERNAME_MAX + 1), 'too_long'],
    ['bad name', 'format'],
    ['bad_name', 'format'],
    ['-lead', 'format'],
    ['trail-', 'format'],
    ['double--hyphen', 'format'],
    ['émigré', 'format'],
    ['pika', 'reserved'],
  ] as const)('rejects %s → %s', (input, reason) => {
    expect(validateUsername(input)).toEqual({ ok: false, reason });
  });
});

describe('word lists', () => {
  it('every list word is a valid lowercase segment, 3–9 chars', () => {
    for (const word of [...USERNAME_ADJECTIVES, ...USERNAME_NOUNS]) {
      expect(word).toMatch(/^[a-z]{3,9}$/);
    }
  });

  it('lists contain no duplicates (within or across — combos stay unique)', () => {
    const all = [...USERNAME_ADJECTIVES, ...USERNAME_NOUNS];
    expect(new Set(all).size).toBe(all.length);
  });

  it('capacity covers the user targets (20 caveat 2)', () => {
    // ≥20k plain combos: a clean two-word name stays likely at the 10k-user
    // target; the ×100 suffix space covers 100k users outright.
    expect(USERNAME_ADJECTIVES.length * USERNAME_NOUNS.length).toBeGreaterThanOrEqual(20_000);
  });

  it('longest possible adjective-noun combo fits the max length with suffix headroom', () => {
    const longest = (list: readonly string[]) =>
      list.reduce((a, b) => (b.length > a.length ? b : a));
    const combo = `${longest(USERNAME_ADJECTIVES)}-${longest(USERNAME_NOUNS)}`;
    expect(combo.length + 3).toBeLessThanOrEqual(USERNAME_MAX);
  });
});

describe('decomposeUsername (the no-free-form client mirror)', () => {
  it('accepts adjective-noun', () => {
    expect(decomposeUsername('noble-lynx')).toEqual({ adjective: 'noble', noun: 'lynx', suffix: '' });
  });

  it('accepts adjective-noun-NN (normalizing case)', () => {
    expect(decomposeUsername('Noble-Lynx-42')).toEqual({ adjective: 'noble', noun: 'lynx', suffix: '42' });
  });

  it.each([
    ['assmuncher-fox'], // non-list adjective — the whole point
    ['noble-assmuncher'], // non-list noun
    ['noble'], // single word
    ['noble-lynx-7'], // 1-digit suffix
    ['noble-lynx-421'], // 3-digit suffix
    ['noble-lynx-4x'], // non-numeric suffix
    ['lynx-noble'], // swapped kinds
    [''],
  ])('rejects %s', (input) => {
    expect(decomposeUsername(input)).toBeNull();
  });
});

describe('formatUsername (display derives, storage stays canonical)', () => {
  it.each([
    ['noble-lynx', 'Noble Lynx'],
    ['noble-lynx-42', 'Noble Lynx 42'],
    ['fluent-marmot', 'Fluent Marmot'],
    ['pika-a1b2c3', 'Pika A1b2c3'], // hash last-resort still renders sanely
    ['', ''],
  ])('%s → %s', (raw, display) => {
    expect(formatUsername(raw)).toBe(display);
  });

  it('every list word title-cases cleanly (single leading capital)', () => {
    for (const word of [...USERNAME_ADJECTIVES, ...USERNAME_NOUNS]) {
      const shown = formatUsername(word);
      expect(shown.charAt(0)).toBe(word.charAt(0).toUpperCase());
      expect(shown.slice(1)).toBe(word.slice(1));
    }
  });
});

describe('generateUsernameCandidate (local cycle — draft-only)', () => {
  it('is deterministic under an injected rng', () => {
    expect(generateUsernameCandidate(() => 0)).toBe(
      `${USERNAME_ADJECTIVES[0]}-${USERNAME_NOUNS[0]}`,
    );
  });

  it('always yields a decomposable, valid name (500 draws)', () => {
    for (let i = 0; i < 500; i += 1) {
      const name = generateUsernameCandidate();
      expect(name).toMatch(USERNAME_PATTERN);
      expect(decomposeUsername(name)).not.toBeNull();
      expect(validateUsername(name).ok).toBe(true);
    }
  });

  it('avoids the current draft so every cycle tap visibly changes the name', () => {
    const avoid = `${USERNAME_ADJECTIVES[0]}-${USERNAME_NOUNS[0]}`;
    // rng pinned to 0 would always re-draw `avoid`; the avoid path must escape
    // via the suffixed fallback instead.
    const next = generateUsernameCandidate(() => 0, avoid);
    expect(next).not.toBe(avoid);
    expect(decomposeUsername(next)).not.toBeNull();
  });

  it('reserved single words can never appear as full names (structurally)', () => {
    // A generated name is always two list words — 'pika' alone is impossible.
    for (const name of [generateUsernameCandidate(), generateUsernameCandidate()]) {
      expect(USERNAME_RESERVED.has(name)).toBe(false);
      expect(name.length).toBeGreaterThanOrEqual(USERNAME_MIN);
    }
  });
});
