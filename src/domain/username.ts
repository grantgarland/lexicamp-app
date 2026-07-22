/**
 * Username domain rules + candidate cycling — spec 20 §3 (v2, R5: reroll-only).
 *
 * MIRROR WARNING: USERNAME_ADJECTIVES / USERNAME_NOUNS duplicate the
 * `username_words` table seeded by migration
 * `20260722184525_username_change_policy` — the parity jest test parses that
 * mirror file and fails if either side drifts. Change both or neither.
 *
 * The client CYCLES candidates locally from these lists (no network per tap);
 * `set_username` server-side re-validates that any saved name decomposes into
 * official-list words, so free-form names are impossible even from a modified
 * client. Pure module: no imports, no I/O.
 */

export const USERNAME_MIN = 3;
export const USERNAME_MAX = 24;

/** lowercase alnum segments joined by single hyphens; no lead/trail/double `-` */
export const USERNAME_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** Mirror of `username_reserved` seed rows (generator namespace guard). */
export const USERNAME_RESERVED: ReadonlySet<string> = new Set([
  'admin',
  'administrator',
  'lexicamp',
  'pika',
  'support',
  'help',
  'mod',
  'moderator',
  'official',
  'staff',
  'root',
  'system',
  'api',
  'null',
  'undefined',
  'anonymous',
  'deleted',
  'user',
]);

export type UsernameValidation =
  | { ok: true; value: string }
  | { ok: false; reason: 'too_short' | 'too_long' | 'format' | 'reserved' };

/**
 * Structural validation (server CHECK mirror). Kept for the mock + tests;
 * the save path's REAL gate is `decomposeUsername` (list membership).
 */
export function validateUsername(raw: string): UsernameValidation {
  const value = raw.trim().toLowerCase();
  if (value.length < USERNAME_MIN) return { ok: false, reason: 'too_short' };
  if (value.length > USERNAME_MAX) return { ok: false, reason: 'too_long' };
  if (!USERNAME_PATTERN.test(value)) return { ok: false, reason: 'format' };
  if (USERNAME_RESERVED.has(value)) return { ok: false, reason: 'reserved' };
  return { ok: true, value };
}

/** MIRROR of the migration's adj seeds — same words (order preserved). */
export const USERNAME_ADJECTIVES: readonly string[] = [
  'fluent', 'polyglot', 'wandering', 'steady', 'bright', 'curious', 'alpine', 'brave',
  'quick', 'mindful', 'patient', 'bold', 'clever', 'eager', 'gentle', 'hardy',
  'keen', 'lively', 'merry', 'nimble', 'plucky', 'quiet', 'rugged', 'sunny',
  'swift', 'trusty', 'valiant', 'witty', 'agile', 'breezy', 'calm', 'daring',
  'earnest', 'frosty', 'golden', 'happy', 'intrepid', 'jolly', 'lofty', 'mellow',
  'noble', 'peppy', 'radiant', 'sturdy', 'upbeat', 'vivid', 'warm', 'zealous',
  'amber', 'azure', 'coral', 'crimson', 'emerald', 'indigo', 'ivory', 'scarlet',
  'silver', 'teal', 'violet', 'misty', 'snowy', 'starry', 'windswept', 'ardent',
  'artful', 'astute', 'balmy', 'blithe', 'bonny', 'brisk', 'bubbly', 'candid',
  'capable', 'cheerful', 'chipper', 'cordial', 'cozy', 'crafty', 'dapper', 'deft',
  'devoted', 'driven', 'dutiful', 'faithful', 'fearless', 'festive', 'fleet', 'gallant',
  'genial', 'gifted', 'glad', 'gleeful', 'graceful', 'gracious', 'grand', 'hearty',
  'helpful', 'honest', 'hopeful', 'humble', 'jaunty', 'jovial', 'joyful', 'kindly',
  'learned', 'limber', 'lucid', 'lucky', 'loyal', 'mighty', 'modest', 'neat',
  'nifty', 'peaceful', 'perky', 'poised', 'polished', 'prudent', 'punctual', 'quaint',
  'ready', 'refined', 'robust', 'rosy', 'serene', 'sharp', 'shrewd', 'sincere',
  'skilled', 'smart', 'snug', 'spirited', 'spry', 'stalwart', 'stellar', 'stout',
  'sunlit', 'supple', 'tactful', 'tidy', 'tranquil', 'vibrant', 'wise', 'zesty',
  'onward',
];

/** MIRROR of the migration's noun seeds — same words (order preserved). */
export const USERNAME_NOUNS: readonly string[] = [
  'pika', 'marmot', 'ibex', 'chamois', 'lynx', 'falcon', 'raven', 'otter',
  'badger', 'ermine', 'hare', 'eagle', 'condor', 'fox', 'elk', 'owl',
  'swallow', 'finch', 'wren', 'robin', 'heron', 'crane', 'cairn', 'ridge',
  'summit', 'glacier', 'crag', 'tarn', 'fjord', 'mesa', 'tundra', 'peak',
  'trail', 'compass', 'lantern', 'satchel', 'journal', 'atlas', 'lexeme', 'phoneme',
  'glyph', 'rune', 'scribe', 'saga', 'fable', 'sonnet', 'proverb', 'riddle',
  'cipher', 'accent', 'idiom', 'dialect', 'syllable', 'echo', 'ballad', 'lyric',
  'verse', 'parable', 'koan', 'haiku', 'anthem', 'chorus', 'yodel', 'alcove',
  'aspen', 'beacon', 'birch', 'bluff', 'boulder', 'brook', 'bunting', 'canyon',
  'cascade', 'cedar', 'chalet', 'cliff', 'cloud', 'clover', 'comet', 'cove',
  'creek', 'crest', 'cuckoo', 'dale', 'dawn', 'delta', 'dune', 'ember',
  'fern', 'firefly', 'ford', 'forest', 'gale', 'geyser', 'glade', 'glen',
  'gorge', 'granite', 'grotto', 'grove', 'gull', 'harbor', 'hawk', 'hollow',
  'horizon', 'ibis', 'inlet', 'island', 'juniper', 'kestrel', 'knoll', 'lagoon',
  'lake', 'larch', 'lark', 'ledge', 'lichen', 'linnet', 'lodge', 'magpie',
  'maple', 'meadow', 'moraine', 'moss', 'nook', 'oriole', 'osprey', 'pebble',
  'pine', 'plover', 'prairie', 'quill', 'rapids', 'ravine', 'reef', 'refuge',
  'river', 'saddle', 'sequoia', 'sierra', 'slope', 'sparrow', 'spring', 'spruce',
  'stone',
];

const ADJ_SET = new Set(USERNAME_ADJECTIVES);
const NOUN_SET = new Set(USERNAME_NOUNS);

export interface UsernameParts {
  adjective: string;
  noun: string;
  /** two-digit collision suffix, '' when absent */
  suffix: string;
}

/**
 * Decompose a canonical name into official-list parts — the client mirror of
 * set_username's no-free-form gate. Returns null for anything that is not
 * `adjective-noun` or `adjective-noun-NN` composed from the lists.
 */
export function decomposeUsername(raw: string): UsernameParts | null {
  const parts = raw.trim().toLowerCase().split('-');
  if (parts.length !== 2 && parts.length !== 3) return null;
  const [adjective, noun, suffix = ''] = parts;
  if (!ADJ_SET.has(adjective) || !NOUN_SET.has(noun)) return null;
  if (parts.length === 3 && !/^[0-9]{2}$/.test(suffix)) return null;
  return { adjective, noun, suffix };
}

const cap = (w: string): string => w.charAt(0).toUpperCase() + w.slice(1);

/**
 * Display form (20 caveat 1): canonical `noble-lynx-42` renders as
 * "Noble Lynx 42" — storage stays lowercase-hyphenated (unique index,
 * URL-safe); presentation is derived, never stored. Non-decomposable
 * values (e.g. the hash last-resort `pika-a1b2c3`) title-case per segment.
 */
export function formatUsername(raw: string): string {
  const name = raw.trim().toLowerCase();
  if (name === '') return '';
  return name.split('-').map(cap).join(' ');
}

/**
 * Local candidate for the cycle button. Draft-only — nothing is written until
 * the user SAVES (set_username claims under the unique index; a taken draft
 * surfaces as `username_taken` and the user cycles again). `rng` injectable
 * for deterministic tests. `avoid` lets the cycler skip the current draft so
 * every tap visibly changes the name.
 */
export function generateUsernameCandidate(rng: () => number = Math.random, avoid?: string): string {
  for (let i = 0; i < 5; i += 1) {
    const adj = USERNAME_ADJECTIVES[Math.floor(rng() * USERNAME_ADJECTIVES.length)];
    const noun = USERNAME_NOUNS[Math.floor(rng() * USERNAME_NOUNS.length)];
    const candidate = `${adj}-${noun}`;
    if (candidate !== avoid) return candidate;
  }
  const adj = USERNAME_ADJECTIVES[Math.floor(rng() * USERNAME_ADJECTIVES.length)];
  const noun = USERNAME_NOUNS[Math.floor(rng() * USERNAME_NOUNS.length)];
  return `${adj}-${noun}-${String(Math.floor(rng() * 100)).padStart(2, '0')}`;
}
