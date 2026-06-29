// Canonical mastery-tier registry — TS port of lexicamp-design-system `_shared/tiers.js`.
// Single source of truth for the 5 tiers (id/name/numeral/CEFR/colors/stability + helpers).
// Colors bind to generated design tokens. Tier names + CEFR:
// BC=A1, ABC=A2, HC=B1/B2, SR=C1, Summit=C2.  `badgeSrc` = asset key (TierBadge maps to require()).
import { tokens } from './tokens.generated';

const c = tokens.palette;

export type TierId = 'bc' | 'abc' | 'hc' | 'sr' | 'summit';

export interface Tier {
  id: TierId;
  name: string;
  short: string;
  numeral: number;          // 1–5 (milestones)
  chipGlyph: number | string; // in-quiz chip glyph (1–4, '★')
  cefr: string;
  wordCount: number;        // cumulative words at tier
  color: string; accent: string;
  bg: string; border: string; text: string; labelColor: string;
  badgeBg: string; badgeText: string; badgeBorder: string;
  badgeSrc: string;         // asset key
  stMin: number; stMax: number; // FSRS stability range (days)
  stabilityRange: string; stabilityDesc: string;
  aliases: string[];
}

export const TIERS: Tier[] = [
  {
    id: 'bc', name: 'Base Camp', short: 'BC', numeral: 1, chipGlyph: 1,
    cefr: 'A1', wordCount: 100,
    color: c.green[500], accent: c.green[500],
    bg: c.green[100], border: c.green[300], text: c.green[900], labelColor: c.green[800],
    badgeBg: c.green[100], badgeText: c.green[900], badgeBorder: c.green[300],
    badgeSrc: 'tier-badge-base-camp',
    stMin: 0, stMax: 3,
    stabilityRange: 'Stability < 3 days', stabilityDesc: 'Recently introduced words. Keep reviewing to build memory.',
    aliases: ['base_camp', 'basecamp'],
  },
  {
    id: 'abc', name: 'Adv. Base Camp', short: 'ABC', numeral: 2, chipGlyph: 2,
    cefr: 'A2', wordCount: 500,
    color: c.green[400], accent: c.green[400],
    bg: c.green[50], border: c.green[200], text: c.green[800], labelColor: c.green[700],
    badgeBg: c.green[50], badgeText: c.green[800], badgeBorder: c.green[200],
    badgeSrc: 'tier-badge-advance-base-camp',
    stMin: 3, stMax: 7,
    stabilityRange: 'Stability 3 – 7 days', stabilityDesc: 'Retention is forming. Consistent reviews push words higher.',
    aliases: ['adv_base', 'advance_base_camp'],
  },
  {
    id: 'hc', name: 'High Camp', short: 'HC', numeral: 3, chipGlyph: 3,
    cefr: 'B1 / B2', wordCount: 1000,
    color: c.blue[600], accent: c.blue[600],
    bg: c.blue[100], border: c.blue[300], text: c.blue[900], labelColor: c.blue[800],
    badgeBg: c.blue[100], badgeText: c.blue[900], badgeBorder: c.blue[300],
    badgeSrc: 'tier-badge-high-camp',
    stMin: 7, stMax: 14,
    stabilityRange: 'Stability 7 – 14 days', stabilityDesc: 'Strong memory forming. These words are getting sticky.',
    aliases: ['high_camp'],
  },
  {
    id: 'sr', name: 'Summit Ridge', short: 'SR', numeral: 4, chipGlyph: 4,
    cefr: 'C1', wordCount: 2000,
    color: c.blue[400], accent: c.blue[400],
    bg: c.blue[50], border: c.blue[200], text: c.blue[800], labelColor: c.blue[700],
    badgeBg: c.blue[50], badgeText: c.blue[800], badgeBorder: c.blue[200],
    badgeSrc: 'tier-badge-summit-ridge',
    stMin: 14, stMax: 30,
    stabilityRange: 'Stability 14 – 30 days', stabilityDesc: 'Long-term retention. These words rarely slip now.',
    aliases: ['summit_ridge'],
  },
  {
    id: 'summit', name: 'Summit', short: '★', numeral: 5, chipGlyph: '★',
    cefr: 'C2', wordCount: 3000,
    color: c.amber[500], accent: c.amber[500],
    bg: c.amber[50], border: c.amber[200], text: c.amber[800], labelColor: c.amber[700],
    badgeBg: c.amber[100], badgeText: c.amber[800], badgeBorder: c.amber[200],
    badgeSrc: 'tier-badge-summit',
    stMin: 30, stMax: Infinity,
    stabilityRange: 'Stability 30+ days', stabilityDesc: 'Mastered. Retained for the long haul — fluency vocabulary.',
    aliases: ['s'],
  },
];

export const TIER_BY_ID: Record<string, Tier> = (() => {
  const m: Record<string, Tier> = {};
  for (const t of TIERS) { m[t.id] = t; for (const a of t.aliases) m[a] = t; }
  return m;
})();

/** Lookup by canonical id or any legacy alias (bc / base_camp / s / summit_ridge …). */
export const getTier = (idOrAlias: string): Tier => TIER_BY_ID[idOrAlias] ?? TIERS[0];

/** FSRS stability (days) → tier. */
export const getTierByStability = (stability: number): Tier =>
  TIERS.find((t) => stability >= t.stMin && stability < t.stMax) ?? TIERS[0];
