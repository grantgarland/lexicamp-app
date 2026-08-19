// Mock DataSource — seeded with real Card + CardFsrsState fixtures per the dev
// scenario, so every home/progress number is DERIVED by `derive.ts` (not hardcoded).
// Swappable for SupabaseDataSource later behind the same interface.
import { evaluateCaptureInput } from '@/domain/capture';
import { directionLangs, freeTierUsage, homeSnapshot } from '@/domain/derive';
import { decomposeUsername } from '@/domain/username';
import type { BufferedRating, QuizCardItem } from '@/domain/quiz';
import { assessResultQuality, type DictionarySense, type LookupOutcome, type LookupResult } from '@/domain/translation';
import { isPaid, type Card, type CardFsrsState, type Deck, type Entitlement, type NotificationPrefs, type Profile, type SearchDirection } from '@/domain/types';
import { type DevPlan, type DevUserState, useDevStore } from '@/store/devStore';
import { getTierByStability, TIERS } from '@/theme/tiers';

import type { DataSource, DeckCards, DeckSummary, Engagement, LeaderboardEntry, ProgressStats, WordListItem } from './DataSource';

const USER_ID = 'dev-user';
const DECK_ID = 'dev-deck';

// Phase D mock language state: two enrolled languages so the switcher is
// demo-able offline. Spanish carries the scenario fixtures; French is a fresh
// (empty) language, which makes the switch repaint unmistakable in dev.
let mockLearningLangs: string[] = ['es', 'fr'];
let mockActiveLang = 'es';
let mockDisplayName = 'Casey';
// Re-synced from the device on every session start (2026-08-12) rather than
// frozen at onboarding, so it has to be mutable here too.
let mockTimezone = 'America/New_York';
// 20 §3 v2: username identity. The taken fixtures make the save-race
// ("snapped up just now") path demo-able offline — cycle until one of these
// appears (or hardcode a draft in dev) and Save to see the taken toast.
let mockUsername = 'fluent-marmot';
let mockUsernameChanges = 0;
const MOCK_TAKEN = new Set(['alpine-elk', 'steady-ibex', 'quick-pika']);
// E3: archived word ids (mock words rebuild per call; this overlays the flag).
let mockArchived = new Set<string>();
// Edit Translations (Premium, 2026-07-28): cardId → user-edited target text.
// Same overlay shape as mockArchived — the fixtures rebuild per call, this
// survives across them so an edit sticks for the length of the dev session.
let mockTargetOverrides = new Map<string, string>();

const PROFILE: Profile = {
  id: USER_ID,
  username: 'fluent-marmot',
  usernameChanges: 0,
  displayName: 'Casey',
  nativeLang: 'en',
  targetLang: 'es',
  timezone: 'America/New_York',
  onboardingComplete: true,
  quizLength: 20,
  // 60 days back → allowance 350 in mock: roomy, and stable enough that dev
  // screens never bump the mock cap in normal use.
  createdAt: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000),
};

const DECK: Deck = { id: DECK_ID, userId: USER_ID, name: 'Spanish', sourceLang: 'en', targetLang: 'es' };

// reps>0 word counts per tier, registry order [bc, abc, hc, sr, summit].
const DISTRIBUTION: Record<DevUserState, number[]> = {
  empty: [0, 0, 0, 0, 0],
  bc: [12, 0, 0, 0, 0],
  abc: [20, 18, 0, 0, 0],
  hc: [10, 20, 12, 0, 0],
  sr: [10, 20, 12, 8, 0],
  summit: [10, 20, 12, 5, 13],
  // Past the summit: 3,050 mastered, with the tail a real veteran still carries
  // — you don't stop saving words once you get there, so the lower tiers are
  // populated by recent captures rather than empty. 4,300 total.
  veteran: [180, 260, 340, 470, 3050],
};
// A representative stability (days) inside each tier's band.
const TIER_STABILITY = [1.5, 5, 10, 20, 45];
const STREAK: Record<DevUserState, number> = { empty: 1, bc: 3, abc: 7, hc: 10, sr: 12, summit: 14, veteran: 63 };

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

// ── Realistic FSRS history (the 'veteran' scenario) ─────────────────────────
// Every other scenario pins one flat stability per tier. That is fine at 60
// words — you can see the whole list — but it is actively misleading at 3,000:
// with identical stability the maturation curve steps as a single cliff, every
// due date lands on the same four offsets, and the projection chart renders a
// shape no real library ever produces. The scenario exists to catch exactly
// those defects, so its data has to have real spread. (Casey ruling, 2026-08-04.)
//
// Deterministic: a seeded PRNG, not Math.random. A dev scenario that reshuffles
// on every render can't be used to reproduce a rendering bug — same discipline
// as the disabled FSRS fuzz (02).
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Per-tier stability bands, mirroring `theme/tiers.ts` stMin/stMax. The summit
 *  band is open-ended (30 → ∞); 30–540 days covers "just mastered" through
 *  "seen twice in three years" without inventing decade-long intervals. */
const TIER_BANDS: [number, number][] = [
  [0.5, 3],
  [3, 7],
  [7, 14],
  [14, 30],
  [30, 540],
];

export interface MockFsrsSample {
  stability: number;
  difficulty: number;
  reps: number;
  lapses: number;
  createdAt: Date;
  lastReviewAt: Date;
  dueAt: Date;
}

/** One card's plausible history. Called with the SAME (tierIdx, g) from both
 *  `buildDeckCards` and `buildWords` so Home's stats and My Words can't disagree. */
function realisticFsrs(tierIdx: number, g: number, now: number): MockFsrsSample {
  const rand = mulberry32(g * 2654435761 + tierIdx);
  const [lo, hi] = TIER_BANDS[tierIdx];
  // Log-uniform within the band: stability compounds review over review, so the
  // real distribution is heavily skewed toward the low end of any band. Uniform
  // sampling would put as many 400-day words as 40-day ones.
  const stability = lo * Math.pow(hi / lo, rand());

  // A word is somewhere between "just reviewed" and "due right now" — the
  // elapsed fraction of its own interval IS its retrievability spread, which is
  // what makes the due-date histogram look like a real queue instead of four
  // spikes. A slice run past 1.0 gives the overdue backlog every real user has.
  const elapsedFrac = rand() < 0.08 ? 1 + rand() * 0.6 : rand();
  const lastReviewAt = new Date(now - stability * elapsedFrac * DAY);
  const dueAt = new Date(lastReviewAt.getTime() + stability * DAY);

  // Reps grow with stability (that IS how a card got stable), with noise.
  const reps = Math.max(1, Math.round(2 + Math.log2(stability + 1) * 2.2 + rand() * 3));
  // Lapses are rarer on the words that survived to a high band.
  const lapses = rand() < 0.35 / (tierIdx + 1) ? 1 + Math.floor(rand() * 2) : 0;
  // FSRS difficulty is 1–10 and clusters mid-scale; harder words tend to sit in
  // the lower bands, which is why the mean slides down as the tier goes up.
  const difficulty = Math.min(10, Math.max(1, 6.5 - tierIdx * 0.5 + (rand() - 0.5) * 3));

  // Saved before it could possibly have matured: at least as long ago as the
  // reviews it took to get here, spread over a multi-year library.
  const ageDays = stability * (1.5 + rand() * 2) + reps * (1 + rand() * 3);
  return { stability, difficulty, reps, lapses, createdAt: new Date(now - ageDays * DAY), lastReviewAt, dueAt };
}

/** Words per day the seeded scenarios were captured at.
 *
 *  `projectionBase` derives the capture rate as `cards.length / librarySpan`,
 *  so the ONLY thing that sets a fixture's pace is how far apart the synthetic
 *  `createdAt` values sit. They used to be one day apart, which made every
 *  scenario a 1.0-word/day learner — and at 1.0/day the Summit projection is
 *  **8.3 years**, which is the number the onboarding shot was showing.
 *
 *  17/day is a plausible-but-committed learner (a few minutes of capture a
 *  day), and it lands the Summit estimate around 7 months. Used by BOTH
 *  builders below; they must agree, or Home's stats and My Words disagree
 *  about the same library. */
const MOCK_CAPTURE_PER_DAY = 17;

/** Synthetic capture date for the g-th seeded card. Every 6th word lands inside
 *  TODAY so "added today" is never zero; the rest walk backwards at the pace
 *  above rather than one-per-day.
 *
 *  ⚠️ This used to be a flat `now - 1 HOUR`, which broke its own promise for one
 *  hour every night: `addedToday` counts by the DEVICE-LOCAL day (derive.ts), so
 *  between 00:00 and 01:00 local an hour-old card is YESTERDAY. `addedToday`
 *  went to 0, mockFreeCap.test.ts failed both assertions, and the Settings meter
 *  in mock mode read 0-of-5 while saves were capped. Found 2026-08-19 at 00:18
 *  local. Clamping to the time since local midnight keeps the card genuinely
 *  today at every hour, including the first minute of one. */
function seededCreatedAt(g: number, now: number): Date {
  if (g % 6 === 0) {
    const d = new Date(now);
    const sinceLocalMidnight =
      d.getHours() * HOUR + d.getMinutes() * 60_000 + d.getSeconds() * 1_000 + d.getMilliseconds();
    return new Date(now - Math.min(1 * HOUR, sinceLocalMidnight));
  }
  return new Date(now - ((g + 2) / MOCK_CAPTURE_PER_DAY) * DAY);
}

function buildDeckCards(userState: DevUserState): DeckCards {
  const cards: Card[] = [];
  const states: CardFsrsState[] = [];
  const dist = DISTRIBUTION[userState];
  const now = Date.now();
  let g = 0; // global index, spreads due/created dates deterministically

  const realistic = userState === 'veteran';

  dist.forEach((count, tierIdx) => {
    for (let j = 0; j < count; j += 1, g += 1) {
      const id = `c${tierIdx}_${j}`;
      const s = realistic ? realisticFsrs(tierIdx, g, now) : null;
      // due spread → realistic Need-Recall (today + backlog) / Due-tomorrow counts
      const dueAt =
        s != null ? s.dueAt
        : g % 4 === 0 ? new Date(now - 2 * HOUR) // overdue today
        : g % 4 === 1 ? new Date(now - 3 * DAY) // overdue backlog
        : g % 4 === 2 ? new Date(now + 6 * HOUR) // due in next 24h
        : new Date(now + 5 * DAY); // future
      const createdAt = s != null ? s.createdAt : seededCreatedAt(g, now);

      cards.push({
        id,
        deckId: DECK_ID,
        userId: USER_ID,
        translationId: `t_${id}`,
        userNote: null,
        customFront: null,
        customBack: null,
        suspended: false,
        createdAt,
      });
      states.push({
        cardId: id,
        userId: USER_ID,
        stability: s?.stability ?? TIER_STABILITY[tierIdx],
        difficulty: s?.difficulty ?? 5,
        dueAt,
        lastReviewAt: s?.lastReviewAt ?? new Date(now - 1 * DAY),
        state: 2, // review
        reps: s?.reps ?? 3,
        lapses: s?.lapses ?? 0,
        learningSteps: 0,
      });
    }
  });

  return { cards, states };
}

// Saves made in THIS mock session. The fixtures' `addedToday` is a static
// scenario property, so without a counter the cap would be all-or-nothing: a
// scenario at 5/5 could never save and one at 2/5 could save forever. Reset on
// scenario change for the same reason decks re-seed — a different scenario is a
// different user, and carrying a counter across would cap the wrong one.
let mockSavesToday = 0;
let mockSavesCountedFor: string | null = null;

/** Mirrors `save_card`'s free-tier cap (spec 19 / migration
 *  `daily_free_save_allowance`): 50-word starter allotment, then 5/day. Paid
 *  plans are uncapped. Same `freeTierUsage` the Settings meter reads, so the
 *  number on screen and the refusal can never disagree. */
function freeSaveExhausted(): boolean {
  const { plan, userState } = scenario();
  // Keyed on plan too, not just userState: flipping the dev plan knob is the
  // operator saying "show me the other user", and carrying a spent counter into
  // that is the kind of stale-state surprise the knob exists to avoid.
  const key = `${userState}:${plan}`;
  if (mockSavesCountedFor !== key) {
    mockSavesCountedFor = key;
    mockSavesToday = 0;
  }
  if (isPaid(entitlementFor(plan))) return false;
  const deck = buildDeckCards(userState);
  const snap = homeSnapshot(deck.cards, deck.states);
  const usage = freeTierUsage(snap.wordsSaved + mockSavesToday, snap.addedToday + mockSavesToday);
  return usage.phase === 'starter' ? usage.saved >= usage.limit : usage.usedToday >= usage.limit;
}

function entitlementFor(plan: DevPlan): Entitlement {
  return plan === 'paid'
    ? { status: 'active', plan: 'monthly', platform: 'ios', currentPeriodEnd: new Date(Date.now() + 30 * DAY), autoRenew: true }
    : { status: 'free', plan: null, platform: null, currentPeriodEnd: null, autoRenew: null };
}

// Mock study queue — a session of due cards with display content + tier + mode.
// (mode: lower tiers = recognition / tap-to-reveal; higher = recall / char input.)
// `fsrs` scheduling state is synthesized per tier at getDueCards() time.
const QUIZ_SESSION: Omit<QuizCardItem, 'fsrs'>[] = [
  { id: 'q_melancolico', tierId: 'bc', mode: 'recognition', content: { frontWord: 'melancólico', frontSub: '/me.laŋˈko.li.ko/', frontPrompt: "What's the translation?", backWord: 'melancholic', backPhonetic: '/ˌmɛl.ənˈkɒl.ɪk/', backPos: 'adjective', backExample: 'A melancholic melody filled the room.' } },
  { id: 'q_ephemeral', tierId: 'abc', mode: 'recognition', content: { frontWord: 'ephemeral', frontSub: '/ɪˈfɛm.ər.əl/', frontPrompt: 'What is the translation?', backWord: 'efímero', backPhonetic: '/eˈfi.me.ɾo/', backPos: 'adjective', backExample: 'La belleza de las flores es efímera.' } },
  { id: 'q_nostalgia', tierId: 'bc', mode: 'recognition', content: { frontWord: 'nostalgia', frontSub: '/nos.ˈtal.xja/', frontPrompt: "What's the translation?", backWord: 'nostalgia', backPhonetic: '/nɒˈstæl.dʒə/', backPos: 'noun', backExample: 'A wave of nostalgia washed over her.' } },
  { id: 'q_grateful', tierId: 'hc', mode: 'recall', content: { frontWord: 'grateful', frontSub: 'Feeling or showing thanks.', frontPrompt: 'Recall the Spanish word.', backWord: 'agradecido', backPhonetic: '/a.ɣɾa.ðeˈθi.ðo/', backPos: 'adjective', backExample: 'Estoy muy agradecido por tu ayuda.' } },
  { id: 'q_serendipity', tierId: 'sr', mode: 'recall', content: { frontWord: 'serendipity', frontSub: 'A fortunate chance discovery.', frontPrompt: 'Recall the Spanish word.', backWord: 'serendipia', backPhonetic: '/se.ɾen.ˈdi.pja/', backPos: 'noun', backExample: 'Fue pura serendipia que nos encontráramos.' } },
  { id: 'q_courage', tierId: 'summit', mode: 'recall', content: { frontWord: 'courage', frontSub: 'Bravery in the face of fear.', frontPrompt: 'Recall the Spanish word.', backWord: 'coraje', backPhonetic: '/koˈɾa.xe/', backPos: 'noun', backExample: 'Enfrentó el reto con coraje.' } },
  // D10 multi-sense pair: same English headword, two RU cards with pre-flip sense
  // hints — exercises the "which variant is this?" disambiguation end-to-end.
  { id: 'q_togo_vehicle', tierId: 'hc', mode: 'recall', content: { frontWord: 'to go', frontSub: 'as in: ride, drive', frontPrompt: 'Recall the Russian word.', backWord: 'ехать', backPhonetic: '/ˈjexətʲ/', backPos: 'verb', backExample: 'Мы едем в город на машине.' } },
  { id: 'q_togo_foot', tierId: 'hc', mode: 'recall', content: { frontWord: 'to go', frontSub: 'as in: walk', frontPrompt: 'Recall the Russian word.', backWord: 'идти', backPhonetic: '/ɪtʲˈtʲi/', backPos: 'verb', backExample: 'Мы идём в парк пешком.' } },
  // Long + multi-word recall test: RU "speed bump" is literally "lying policeman".
  // Verifies horizontal scroll + edge fade + focus traversal + spaces (multi-word).
  { id: 'q_speedbump', tierId: 'summit', mode: 'recall', content: { frontWord: 'speed bump / hump', frontSub: 'A raised ridge in a road to slow traffic.', frontPrompt: 'Recall the Russian phrase.', backWord: 'лежачий полицейский', backPhonetic: '/lʲɪˈʐatɕɪj pəlʲɪˈtsɛjskʲɪj/', backPos: 'noun', backExample: 'Впереди лежачий полицейский — сбавь скорость.' } },
];

// A pool of real ES(native/headword) → EN(target) pairs. Sized to cover the largest
// scenario (summit = 60 words) so no display duplicates. Stands in for translations_cache.
const WORD_BANK: { native: string; target: string }[] = [
  { native: 'melancólico', target: 'melancholic' }, { native: 'efímero', target: 'ephemeral' },
  { native: 'nostalgia', target: 'nostalgia' }, { native: 'serendipia', target: 'serendipity' },
  { native: 'agradecido', target: 'grateful' }, { native: 'felicidad', target: 'happiness' },
  { native: 'libertad', target: 'freedom' }, { native: 'sueño', target: 'dream' },
  { native: 'esperanza', target: 'hope' }, { native: 'sabiduría', target: 'wisdom' },
  { native: 'amistad', target: 'friendship' }, { native: 'valentía', target: 'bravery' },
  { native: 'tristeza', target: 'sadness' }, { native: 'alegría', target: 'joy' },
  { native: 'recuerdo', target: 'memory' }, { native: 'paisaje', target: 'landscape' },
  { native: 'amanecer', target: 'dawn' }, { native: 'atardecer', target: 'dusk' },
  { native: 'estrella', target: 'star' }, { native: 'montaña', target: 'mountain' },
  { native: 'río', target: 'river' }, { native: 'bosque', target: 'forest' },
  { native: 'océano', target: 'ocean' }, { native: 'desierto', target: 'desert' },
  { native: 'tormenta', target: 'storm' }, { native: 'lluvia', target: 'rain' },
  { native: 'nieve', target: 'snow' }, { native: 'viento', target: 'wind' },
  { native: 'fuego', target: 'fire' }, { native: 'tierra', target: 'earth' },
  { native: 'cielo', target: 'sky' }, { native: 'corazón', target: 'heart' },
  { native: 'alma', target: 'soul' }, { native: 'mente', target: 'mind' },
  { native: 'fuerza', target: 'strength' }, { native: 'paciencia', target: 'patience' },
  { native: 'gratitud', target: 'gratitude' }, { native: 'humildad', target: 'humility' },
  { native: 'orgullo', target: 'pride' }, { native: 'destino', target: 'destiny' },
  { native: 'camino', target: 'path' }, { native: 'viaje', target: 'journey' },
  { native: 'aventura', target: 'adventure' }, { native: 'misterio', target: 'mystery' },
  { native: 'silencio', target: 'silence' }, { native: 'susurro', target: 'whisper' },
  { native: 'eco', target: 'echo' }, { native: 'sombra', target: 'shadow' },
  { native: 'reflejo', target: 'reflection' }, { native: 'destello', target: 'sparkle' },
  { native: 'anhelo', target: 'longing' }, { native: 'consuelo', target: 'comfort' },
  { native: 'asombro', target: 'awe' }, { native: 'certeza', target: 'certainty' },
  { native: 'duda', target: 'doubt' }, { native: 'verdad', target: 'truth' },
  { native: 'promesa', target: 'promise' }, { native: 'secreto', target: 'secret' },
  { native: 'tesoro', target: 'treasure' }, { native: 'anochecer', target: 'nightfall' },
];

const POS_POOL = ['noun', 'adj.', 'verb', 'adv.'];
// Parallel source/target example frames (source = ES sentence, target = its EN
// translation) so W-03 can show the pair like the search card does.
const EXAMPLE_FRAMES: { source: (w: string) => string; target: (w: string) => string }[] = [
  { source: (w) => `Uso «${w}» casi todos los días.`, target: (w) => `I use "${w}" almost every day.` },
  { source: (w) => `Esa palabra, «${w}», es muy útil.`, target: (w) => `That word, "${w}", is very useful.` },
  { source: (w) => `Aprendí «${w}» en mi última sesión.`, target: (w) => `I learned "${w}" in my last session.` },
  { source: (w) => `«${w}» apareció en la lectura de hoy.`, target: (w) => `"${w}" came up in today's reading.` },
];

// Word List fixtures — same per-tier distribution as the deck (so "My Words" count
// matches Home's wordsSaved), with real display text + derived metadata. Newest first.
function buildWords(userState: DevUserState): WordListItem[] {
  const dist = DISTRIBUTION[userState];
  const now = Date.now();
  const out: WordListItem[] = [];
  const realistic = userState === 'veteran';
  let g = 0;
  dist.forEach((count, tierIdx) => {
    for (let j = 0; j < count; j += 1, g += 1) {
      const bank = WORD_BANK[g % WORD_BANK.length];
      // The bank holds 60 real pairs — enough that no scenario up to `summit`
      // repeats. `veteran` is 4,300 words, and 4,300 unique curated pairs is a
      // content problem, not a fixture problem: cycle the bank and mark the
      // repeats so every row is still DISTINCT (search, sort and the delete
      // predicates all key off text, and silent duplicates would mask exactly
      // the kind of collision bug this fixture is meant to surface).
      const pass = Math.floor(g / WORD_BANK.length);
      const w = pass === 0 ? bank : { native: `${bank.native} (${pass + 1})`, target: `${bank.target} (${pass + 1})` };
      const s = realistic ? realisticFsrs(tierIdx, g, now) : null;
      const createdAt = s != null ? s.createdAt : seededCreatedAt(g, now);
      const dueAt =
        s != null ? s.dueAt
        : g % 4 === 0 ? new Date(now - 2 * HOUR)
        : g % 4 === 1 ? new Date(now - 3 * DAY)
        : g % 4 === 2 ? new Date(now + 6 * HOUR)
        : new Date(now + 5 * DAY);
      const id = `w${tierIdx}_${j}`;
      const override = mockTargetOverrides.get(id) ?? null;
      out.push({
        id,
        translationId: `mock-t:${w.native}`,
        senseTarget: w.target.toLowerCase(),
        native: w.native,
        target: override ?? w.target,
        targetOverride: override,
        originalTarget: w.target,
        pos: POS_POOL[g % POS_POOL.length],
        example: EXAMPLE_FRAMES[g % EXAMPLE_FRAMES.length].source(w.native),
        exampleTranslation: EXAMPLE_FRAMES[g % EXAMPLE_FRAMES.length].target(w.target),
        provider: 'azure_dictionary',
        stability: s?.stability ?? TIER_STABILITY[tierIdx],
        reps: s?.reps ?? 2 + (g % 9),
        createdAt,
        dueAt,
        suspended: mockArchived.has(id),
      });
    }
  });
  return out.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

// All-time study stats per scenario (mock; real values derive from study_events later).
const PROGRESS_STATS: Record<DevUserState, ProgressStats> = {
  empty: { sessionsTotal: 0, avgAccuracy: 0, bestStreak: 0, daysActive: 0, reviewsTotal: 0, timeInvestedMs: 0 },
  bc: { sessionsTotal: 4, avgAccuracy: 71, bestStreak: 3, daysActive: 4, reviewsTotal: 52, timeInvestedMs: 360000 },
  abc: { sessionsTotal: 12, avgAccuracy: 76, bestStreak: 7, daysActive: 10, reviewsTotal: 168, timeInvestedMs: 1200000 },
  hc: { sessionsTotal: 24, avgAccuracy: 80, bestStreak: 10, daysActive: 18, reviewsTotal: 361, timeInvestedMs: 2580000 },
  sr: { sessionsTotal: 33, avgAccuracy: 82, bestStreak: 12, daysActive: 24, reviewsTotal: 502, timeInvestedMs: 3540000 },
  summit: { sessionsTotal: 42, avgAccuracy: 85, bestStreak: 14, daysActive: 30, reviewsTotal: 648, timeInvestedMs: 4560000 },
  // Three years of near-daily study. daysActive/sessionsTotal drive the
  // projection's confidence banding, so a veteran must read as HIGH confidence
  // — a 3,000-word library still labelled "rough estimate" is its own bug.
  veteran: { sessionsTotal: 1180, avgAccuracy: 91, bestStreak: 214, daysActive: 1024, reviewsTotal: 18400, timeInvestedMs: 129600000 },
};

// Custom decks (Premium). Membership is REAL in the mock as of 2026-07-30 —
// previously these were static fixtures with a hardcoded `wordCount` and no
// contents at all, which is what let the Deck detail sheet ship a positional
// `words.slice(0, wordCount)` stand-in all the way to a live bug report. The
// fixture now seeds each deck with a deterministic STRIDE of the scenario's
// words (so the three decks differ and overlap the way real ones would), the
// count is DERIVED from membership, and create/delete/add/remove mutate it. The
// mock exercises the same contract as the live source; a UI that only works
// against a fixed fixture can't pass here any more.
const DECK_FIXTURES: { meta: Omit<DeckSummary, 'wordCount'>; stride: number; offset: number }[] = [
  { meta: { id: 'd_travel', name: 'Travel', reviews: 9, createdAt: new Date(Date.now() - 24 * DAY), lastReviewedAt: new Date(Date.now() - 2 * DAY) }, stride: 3, offset: 0 },
  { meta: { id: 'd_business', name: 'Business', reviews: 5, createdAt: new Date(Date.now() - 12 * DAY), lastReviewedAt: new Date(Date.now() - 5 * HOUR) }, stride: 4, offset: 1 },
  { meta: { id: 'd_favorites', name: 'Favorites', reviews: 3, createdAt: new Date(Date.now() - 4 * DAY), lastReviewedAt: null }, stride: 5, offset: 2 },
];

let mockDeckMeta: Omit<DeckSummary, 'wordCount'>[] = [];
let mockDeckMembers = new Map<string, Set<string>>();
let mockDecksSeededFor: DevUserState | null = null;

/** Re-seed decks + membership when the dev scenario changes (each scenario has a
 *  different word set, so carrying card ids across would strand memberships). */
function seedDecks(userState: DevUserState): void {
  if (mockDecksSeededFor === userState) return;
  mockDecksSeededFor = userState;
  mockDeckMembers = new Map();
  if (userState === 'empty') {
    mockDeckMeta = []; // new user → decks-tab empty state (they can still create one)
    return;
  }
  const words = buildWords(userState);
  mockDeckMeta = DECK_FIXTURES.map((f) => f.meta);
  DECK_FIXTURES.forEach((f) => {
    mockDeckMembers.set(f.meta.id, new Set(words.filter((_, i) => i % f.stride === f.offset).map((w) => w.id)));
  });
}

/** WordListItem → QuizCardItem for a deck-scoped mock session. Recognition below
 *  the hard-climb tier, recall at and above it — the same shape the fixture
 *  session uses, derived rather than hand-written. Preserves the real dueAt so
 *  the due-first ordering and the 18 §2c fill behave like the live source. */
function buildDeckSession(userState: DevUserState, deckId: string, limit: number): QuizCardItem[] {
  seedDecks(userState);
  const ids = mockDeckMembers.get(deckId);
  if (ids == null) return [];
  const now = Date.now();
  return buildWords(userState)
    .filter((w) => ids.has(w.id) && !w.suspended) // archived words leave the queue (18 §E3)
    .map((w) => {
      const tier = getTierByStability(w.stability);
      const tierIdx = TIERS.findIndex((x) => x.id === tier.id);
      return {
        id: w.id,
        tierId: tier.id,
        mode: tierIdx >= 2 ? ('recall' as const) : ('recognition' as const),
        content: {
          frontWord: tierIdx >= 2 ? w.native : w.target,
          frontSub: w.pos || undefined,
          frontPrompt: tierIdx >= 2 ? 'Recall the word.' : "What's the translation?",
          backWord: tierIdx >= 2 ? w.target : w.native,
          backPos: w.pos || undefined,
          backExample: w.example || undefined,
        },
        fsrs: {
          cardId: w.id,
          userId: USER_ID,
          stability: w.stability,
          difficulty: 5,
          dueAt: w.dueAt,
          lastReviewAt: new Date(now - Math.round(w.stability * DAY)),
          state: 2 as const,
          reps: w.reps,
          lapses: 0,
          learningSteps: 0,
        },
      };
    })
    .sort((a, b) => a.fsrs.dueAt.getTime() - b.fsrs.dueAt.getTime())
    .slice(0, Math.max(0, limit));
}

// ── Mock dictionary (Azure dictionary/lookup-shaped, per 16 §1) ───────────────
// 'fly' senses mirror the real Azure documentation example; the generic path
// fabricates a single dictionary-shaped sense from WORD_BANK so every gate-
// passing query resolves (the real source returns not_found on dictionary+
// fallback miss — exercised via the reserved MISS token below).
const MOCK_MISS = 'fly123456'; // Azure's own docs miss-example
// Reserved token that resolves to an identity-echo (target === source) so dev/tests
// can exercise the unsaveable card path (16 §2 result-quality gate).
const MOCK_ECHO = 'echoword';

export const FLY_EXAMPLE = {
  sourcePrefix: 'I mean, for a guy who could ',
  sourceTerm: 'fly',
  sourceSuffix: '.',
  targetPrefix: 'Quiero decir, para un tipo que podía ',
  targetTerm: 'volar',
  targetSuffix: '.',
} as const;

const FLY_SENSES: DictionarySense[] = [
  {
    normalizedTarget: 'volar',
    displayTarget: 'volar',
    posTag: 'VERB',
    confidence: 0.4081,
    prefixWord: '',
    backTranslations: [
      { normalizedText: 'fly', displayText: 'fly', numExamples: 15, frequencyCount: 4637 },
      { normalizedText: 'flying', displayText: 'flying', numExamples: 15, frequencyCount: 1365 },
    ],
  },
  {
    normalizedTarget: 'mosca',
    displayTarget: 'mosca',
    posTag: 'NOUN',
    confidence: 0.2668,
    prefixWord: 'la',
    backTranslations: [{ normalizedText: 'fly', displayText: 'fly', numExamples: 15, frequencyCount: 1697 }],
  },
];

function mockLookupResult(query: string, direction: SearchDirection): LookupOutcome {
  // Gate against the ACTUAL source language for this direction (real Edge Function
  // does the same) so the mock exercises script-consistency too — not hardcoded 'en'.
  const { sourceCode, targetCode } = directionLangs(PROFILE, direction);
  const verdict = evaluateCaptureInput(query, sourceCode);
  if (!verdict.ok) return { status: 'rejected', reason: verdict.reason };
  if (verdict.normalized === MOCK_MISS) return { status: 'not_found' };

  const isPhrase = verdict.normalized.includes(' ');

  let senses: DictionarySense[];
  if (verdict.normalized === MOCK_ECHO) {
    // Identity-echo: target === source (untranslated pass-through) → unsaveable card.
    senses = [
      {
        normalizedTarget: verdict.normalized,
        displayTarget: verdict.display,
        posTag: 'OTHER',
        confidence: 0.2,
        prefixWord: '',
        backTranslations: [],
      },
    ];
  } else if (verdict.normalized === 'fly') {
    senses = FLY_SENSES;
  } else {
    const hit =
      WORD_BANK.find((w) => w.native === verdict.normalized) ??
      WORD_BANK.find((w) => w.target === verdict.normalized);
    const target = hit ? (hit.native === verdict.normalized ? hit.target : hit.native) : `${verdict.normalized}·es`;
    senses = [
      {
        normalizedTarget: target,
        displayTarget: target,
        posTag: isPhrase ? 'OTHER' : 'NOUN',
        confidence: hit ? 0.7 : 0.35,
        prefixWord: '',
        backTranslations: [
          { normalizedText: verdict.normalized, displayText: verdict.display, numExamples: hit ? 5 : 0, frequencyCount: 100 },
        ],
      },
    ];
  }

  // Same PER-SENSE result-quality rule the Edge Function applies server-side
  // (2026-07-23: stamps quality onto each sense, not once for the whole result —
  // see assessResultQuality's doc comment).
  const { senses: qualitySenses } = assessResultQuality({ normalizedSource: verdict.normalized, senses });

  const result: LookupResult = {
    translationId: `mock-t:${verdict.normalized}`,
    normalizedSource: verdict.normalized,
    displaySource: verdict.display,
    sourceLang: sourceCode,
    targetLang: targetCode,
    senses: qualitySenses,
    entryKind: isPhrase ? 'phrase' : 'word',
    provider: 'azure_dictionary',
  };
  return { status: 'found', result };
}

// CI smoke-strings guard (src/test/maestroStrings.test.ts): the Maestro flows in
// `.maestro/` assert these fixture strings, so a fixture drift must fail at jest
// time — not at 3am in the nightly. Keep in lockstep with the flow headers.
// DECK_NAMES/DECK_COUNT are read by `.maestro/decks.yaml` via the guard's
// TEMPLATE_PARAMS: that flow asserts the deck-tab header count before and after
// a create ("3 decks" → "4 decks") and taps the 'Travel'/'Business' rows by
// name.
const DECK_NAMES = DECK_FIXTURES.map((f) => f.meta.name);
export const SMOKE_FIXTURES = {
  WORD_BANK,
  DISTRIBUTION,
  MOCK_MISS,
  MOCK_ECHO,
  FLY_SENSES,
  FLY_EXAMPLE,
  DECK_NAMES,
  DECK_COUNT: DECK_FIXTURES.length,
} as const;

const scenario = () => useDevStore.getState();

// In-memory notification prefs (03 onboarding defaults).
const mockPrefs: NotificationPrefs = { enabled: true, frequency: 'daily', windows: [{ time: '09:00' }], minDueToNotify: 1, days: [0, 1, 2, 3, 4, 5, 6] };

// 20 §4: rival fixtures for a demo leaderboard — already ≥1 mastered, spanning
// a few languages so the Global view's flag column has something to show.
// Simplified vs. the server's tie-breaking RANK (mastered desc, username asc):
// the mock's fixture counts are all distinct, so a plain sort never needs it.
const LEADERBOARD_RIVALS: { username: string; langCode: string; mastered: number }[] = [
  { username: 'summit-wren', langCode: 'ja', mastered: 812 },
  { username: 'alpine-elk', langCode: 'es', mastered: 640 },
  { username: 'cedar-owl', langCode: 'fr', mastered: 505 },
  { username: 'quick-pika', langCode: 'es', mastered: 388 },
  { username: 'frost-hare', langCode: 'de', mastered: 240 },
  { username: 'steady-ibex', langCode: 'ru', mastered: 176 },
  { username: 'coral-lynx', langCode: 'zh-Hans', mastered: 129 },
  { username: 'amber-fox', langCode: 'es', mastered: 74 },
  { username: 'misty-crane', langCode: 'ko', mastered: 41 },
  { username: 'golden-stag', langCode: 'fr', mastered: 12 },
  { username: 'brave-otter', langCode: 'es', mastered: 3 },
];

export const mockDataSource: DataSource = {
  async completeOnboarding(_input) {
    // Mock profile ships onboardingComplete=true; nothing to persist.
  },
  async lookup(query, direction) {
    return mockLookupResult(query, direction);
  },
  async saveCard(_translationId, _custom) {
    // The free-tier cap is MIRRORED here, not persisted state (see above). The
    // rest of this method stays a no-op: screens keep their own optimistic
    // saved-state and there is nothing to write.
    //
    // Why the mirror is worth its weight: the cap is server-enforced (02/3.2),
    // so before this existed mock mode had no cap AT ALL. A capped free scenario
    // would render "5 of 5 saves used today" in Settings and still accept every
    // save — the optimistic "Saved!" stuck (nothing threw, so SearchScreen's
    // onError rollback never ran), the word never appeared in the deck, and the
    // paywall never opened, because the ONLY thing that routes to it is the
    // `free_word_cap` error. Three symptoms, one missing throw.
    if (freeSaveExhausted()) throw new Error('free_word_cap');
    mockSavesToday += 1;
    return null; // no card id in mock mode (A12b — screens fall back to local masks)
  },
  async deleteCard(_cardId) {
    // Mock: nothing persisted to delete; screens keep optimistic removal state.
  },
  async getExamples(translationId, _targetTerm) {
    // One canned example so W-03/detail UIs have something to render.
    // (_targetTerm: per-sense examples, 2026-07-17 — mock serves the same
    // sentence for any sense; the real per-sense behavior lives server-side.)
    return translationId === 'mock-t:fly' ? [FLY_EXAMPLE] : [];
  },
  async getProfile() {
    return { ...PROFILE, targetLang: mockActiveLang as Profile['targetLang'], displayName: mockDisplayName, timezone: mockTimezone, username: mockUsername, usernameChanges: mockUsernameChanges };
  },
  async getEntitlement() {
    return entitlementFor(scenario().plan);
  },
  async getActiveDeck() {
    return DECK;
  },
  async getDeckCards(lang) {
    if ((lang ?? mockActiveLang) !== 'es') return { cards: [], states: [] }; // fresh language (Phase D demo)
    return buildDeckCards(scenario().userState);
  },
  async getEngagement(): Promise<Engagement> {
    return { streakDays: STREAK[scenario().userState] };
  },
  async getProgressStats(lang?: string): Promise<ProgressStats> {
    // A scenario models ONE language, so there is nothing to scope; the
    // parameter exists to keep the mock honest against the live contract.
    if (lang != null && lang !== mockActiveLang) return PROGRESS_STATS.empty;
    return PROGRESS_STATS[scenario().userState];
  },
  async getDecks(lang): Promise<DeckSummary[]> {
    if ((lang ?? mockActiveLang) !== 'es') return []; // fresh language (Phase D demo)
    seedDecks(scenario().userState);
    // wordCount is DERIVED from membership — the count and the list can no
    // longer disagree, which is the whole point of the 2026-07-30 rework.
    return mockDeckMeta.map((d) => ({ ...d, wordCount: mockDeckMembers.get(d.id)?.size ?? 0 }));
  },
  async getDeckWords(deckId: string, lang?: string): Promise<WordListItem[]> {
    if ((lang ?? mockActiveLang) !== 'es') return []; // fresh language (Phase D demo)
    seedDecks(scenario().userState);
    const ids = mockDeckMembers.get(deckId);
    if (ids == null) return [];
    // Ordered like the live source (newest first); buildWords is already newest-first.
    return buildWords(scenario().userState).filter((w) => ids.has(w.id));
  },
  async getCardDeckIds(cardId: string): Promise<string[]> {
    if (mockActiveLang !== 'es') return []; // fresh language (Phase D demo)
    seedDecks(scenario().userState);
    return [...mockDeckMembers.entries()].filter(([, ids]) => ids.has(cardId)).map(([id]) => id);
  },
  async createDeck(name: string, cardIds: string[], lang?: string): Promise<string> {
    // Mock fixtures only exist for 'es' (Phase D demo). Creating a deck under
    // another language would occupy the name space and then be invisible,
    // because getDecks returns [] for those — so reject it the way the server
    // rejects an unseeded language.
    if ((lang ?? mockActiveLang) !== 'es') throw new Error('language_not_enrolled');
    seedDecks(scenario().userState);
    const clean = name.trim().replace(/\s+/g, ' ');
    // Same rejection tokens as the RPC so the sheet's error path is exercised
    // in mock mode too (the premium gate is left to the dev plan knob).
    if (clean.length < 1 || clean.length > 40) throw new Error('deck_name_invalid');
    if (mockDeckMeta.some((d) => d.name.trim().toLowerCase() === clean.toLowerCase())) throw new Error('deck_name_taken');
    const id = `d_${mockDeckMeta.length}_${clean.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
    mockDeckMeta = [...mockDeckMeta, { id, name: clean, reviews: 0, createdAt: new Date(), lastReviewedAt: null }];
    const known = new Set(buildWords(scenario().userState).map((w) => w.id));
    mockDeckMembers.set(id, new Set(cardIds.filter((c) => known.has(c))));
    return id;
  },
  async deleteDeck(deckId: string): Promise<void> {
    seedDecks(scenario().userState);
    mockDeckMeta = mockDeckMeta.filter((d) => d.id !== deckId);
    mockDeckMembers.delete(deckId); // membership goes; the WORDS are untouched
  },
  async addCardToDeck(deckId: string, cardId: string): Promise<void> {
    seedDecks(scenario().userState);
    const ids = mockDeckMembers.get(deckId);
    if (ids == null) throw new Error('deck not found');
    ids.add(cardId); // idempotent, like the RPC's on-conflict-do-nothing
  },
  async removeCardFromDeck(deckId: string, cardId: string): Promise<void> {
    seedDecks(scenario().userState);
    mockDeckMembers.get(deckId)?.delete(cardId);
  },
  async getWords(lang?: string): Promise<WordListItem[]> {
    if ((lang ?? mockActiveLang) !== 'es') return []; // fresh language (Phase D demo)
    return buildWords(scenario().userState);
  },
  async getDueCards(limit: number, lang?: string, deckId?: string): Promise<QuizCardItem[]> {
    if ((lang ?? mockActiveLang) !== 'es') return []; // fresh language (Phase D demo)
    // Deck-scoped session (2026-07-30): composed from the deck's ACTUAL member
    // words, not from the QUIZ_SESSION fixture. The fixture's ids (`q_*`) are
    // disjoint from the word ids membership is keyed on (`w<tier>_<j>`), so
    // filtering it would silently return nothing — and slicing it to the member
    // COUNT would be the positional-prefix lie this whole rework deleted.
    if (deckId != null) return buildDeckSession(scenario().userState, deckId, limit);
    // Synthesize an in-band scheduling state per item so the results screen can
    // compute real FSRS tier transitions (domain/fsrs.tierTransition).
    // 18 §2c fill semantics, mirrored from the live source: the first items are
    // DUE (staggered overdue, oldest first), the tail is UPCOMING (next-due
    // ascending) — the session tops up to `limit` from the future queue.
    //
    // The live source's third tier (the just-reviewed cards it demotes rather
    // than excludes, so a caught-up queue can never come back empty — 2026-08-09)
    // has no counterpart here and needs none: `commitQuizSession` is a no-op in
    // mock, so no card is ever "recently reviewed" and the fixture already
    // satisfies the never-runs-dry contract unconditionally.
    const tierIdxOf: Record<string, number> = { bc: 0, abc: 1, hc: 2, sr: 3, summit: 4 };
    const now = Date.now();
    const dueCount = Math.ceil(QUIZ_SESSION.length / 2); // first half due, rest upcoming
    return QUIZ_SESSION.map((q, i) => ({
      ...q,
      // Edit Translations: the user's text is the answer being studied, so it
      // replaces backWord (and therefore the recall input's slot count too).
      content: mockTargetOverrides.has(q.id) ? { ...q.content, backWord: mockTargetOverrides.get(q.id) as string } : q.content,
      fsrs: {
        cardId: q.id,
        userId: USER_ID,
        stability: TIER_STABILITY[tierIdxOf[q.tierId] ?? 0],
        difficulty: 5,
        // Due items: increasingly overdue toward index 0; upcoming: i-indexed days out.
        dueAt: i < dueCount ? new Date(now - (dueCount - i) * 2 * HOUR) : new Date(now + (i - dueCount + 1) * DAY),
        lastReviewAt: new Date(now - Math.round(TIER_STABILITY[tierIdxOf[q.tierId] ?? 0] * DAY)),
        state: 2 as const,
        reps: 3,
        lapses: 0,
        learningSteps: 0,
      },
    }))
      .sort((a, b) => a.fsrs.dueAt.getTime() - b.fsrs.dueAt.getTime())
      .slice(0, Math.max(0, limit));
  },
  async getNotificationPrefs(): Promise<NotificationPrefs> {
    return { ...mockPrefs };
  },
  async updateNotificationPrefs(prefs) {
    Object.assign(mockPrefs, prefs);
  },
  async unregisterPushToken(_token: string) {
    /* no-op: the mock never registers */
  },
  async registerPushToken(_token, _platform) {
    // Mock: nothing to register.
  },

  // ── Phase D: multi-language (mock) ──────────────────────────────────────
  async getLearningLanguages() {
    return [...mockLearningLangs];
  },
  async addLearningLanguage(lang) {
    if (!mockLearningLangs.includes(lang)) mockLearningLangs = [...mockLearningLangs, lang];
    mockActiveLang = lang;
  },
  async switchLearningLanguage(lang) {
    if (!mockLearningLangs.includes(lang)) throw new Error('not_enrolled');
    mockActiveLang = lang;
  },
  async removeLearningLanguage(lang) {
    if (!mockLearningLangs.includes(lang)) throw new Error('not_enrolled');
    if (lang === mockActiveLang) throw new Error('language_active');
    mockLearningLangs = mockLearningLangs.filter((l) => l !== lang);
  },
  async updateProfile(patch) {
    if (patch.displayName != null) mockDisplayName = patch.displayName.trim() || 'Casey';
    if (patch.timezone != null && patch.timezone.trim() !== '') mockTimezone = patch.timezone.trim();
    // quizLength mirror is a server concern; mock keeps the prefsStore value authoritative.
  },

  // ── 20 §3 v2: username identity (mock — mirrors set_username's rules) ────
  async getAccountIdentity() {
    return { email: 'casey@lexicamp.dev', provider: 'email' as const };
  },
  async setUsername(name) {
    // Same order as the RPC: decompose (no-free-form) → idempotent → free
    // lifetime-1 (scenario plan = entitlement) → taken race → claim.
    const canonical = name.trim().toLowerCase();
    if (decomposeUsername(canonical) == null) throw new Error('username_invalid');
    if (canonical === mockUsername) return mockUsername; // never burns a change
    const paid = scenario().plan !== 'free';
    if (!paid && mockUsernameChanges >= 1) throw new Error('username_change_limit');
    if (MOCK_TAKEN.has(canonical)) throw new Error('username_taken');
    mockUsername = canonical;
    mockUsernameChanges += 1;
    return mockUsername;
  },
  // ── 20 §4: leaderboard (mock — mirrors get_leaderboard's shape) ──────────
  async getLeaderboard(scope, lang, limit = 100): Promise<LeaderboardEntry[]> {
    // Self entries mirror the server's (user, learning-language) grouping —
    // only 'es' carries mock fixture data ('fr' is the fresh Phase D demo
    // language, 0 mastered → excluded, same as the server would exclude it).
    const deck = buildDeckCards(scenario().userState);
    const snap = homeSnapshot(deck.cards, deck.states);
    const selfRows =
      snap.masteredCount > 0
        ? mockLearningLangs.filter((l) => l === 'es').map((l) => ({ username: mockUsername, langCode: l, mastered: snap.masteredCount }))
        : [];
    const pool = [...LEADERBOARD_RIVALS, ...selfRows];
    const scoped = scope === 'global' ? pool : pool.filter((e) => e.langCode === lang);
    const ranked: LeaderboardEntry[] = scoped
      .slice()
      .sort((a, b) => b.mastered - a.mastered || a.username.localeCompare(b.username))
      .map((e, i) => ({ rank: i + 1, username: e.username, langCode: e.langCode, mastered: e.mastered, isSelf: e.username === mockUsername }));
    return ranked.filter((e) => e.rank <= limit || e.isSelf);
  },
  async logEvent() {
    // 3.4: analytics are live-mode only; mock swallows emits.
  },
  async setCardTargetOverride(cardId, target) {
    // Mock: same semantics as the RPC (trim, empty = clear) minus the premium
    // gate — the dev plan knob already drives the UI-side gating.
    const next = new Map(mockTargetOverrides);
    const text = target?.trim() ?? '';
    if (text === '') next.delete(cardId);
    else next.set(cardId, text);
    mockTargetOverrides = next;
  },
  async setCardSuspended(cardId, suspended) {
    const next = new Set(mockArchived);
    if (suspended) next.add(cardId);
    else next.delete(cardId);
    mockArchived = next;
  },
  async getSessionPace(): Promise<number | null> {
    // A plausible measured pace so the mock scenarios exercise the estimate row.
    return 7.5;
  },
  async commitQuizSession(_payload: { ratings: BufferedRating[]; durationMs?: number }): Promise<void> {
    // TODO(P4 data): batch-write per 03 (update card_fsrs_state via ts-fsrs, append
    // review_logs, write quiz_completed event) — Supabase + ts-fsrs. No-op in mock.
  },

  async deleteOwnAccount() {
    // Mock: nothing persistent to destroy — the screen still runs its sign-out
    // and bounce, which is the part worth exercising in mock mode.
  },
};
