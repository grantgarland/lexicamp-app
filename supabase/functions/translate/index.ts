// translate — the capture-gate authority (16 §2 Tier 1).
// normalize → cache → gate → dictionary/lookup → /translate fallback → persist.
// Gate outcomes return 200 with a LookupOutcome body ({status:'found'|'rejected'|
// 'not_found'}) so the client has one shape; 4xx/5xx are auth/rate/infra only.
// Secrets: AZURE_TRANSLATOR_KEY, AZURE_TRANSLATOR_REGION (Supabase secrets).
// SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are injected by the platform.
//
// ⚠️ The Tier-0 rules below intentionally mirror src/domain/capture.ts in the
// app. If you change one, change both (capture.test.ts is the shared spec).
// @ts-ignore — Deno npm: specifier resolved at runtime, not by TS tooling.
import { createClient } from '@supabase/supabase-js';

declare const Deno: {
  env: { get(key: string): string | undefined };
  serve(handler: (req: Request) => Response | Promise<Response>): void;
};

// ── Tier-0 gate (mirror of src/domain/capture.ts) ────────────────────────────
type RejectReason = 'empty' | 'too_long' | 'too_many_words' | 'sentence_like' | 'not_a_word' | 'wrong_script';

const CONTROL_CHARS = /[\u0000-\u001F\u007F\u200B-\u200D\uFEFF]/g;
const WRAP_PUNCT = /^["'«»„“”‘’()[\]¿¡]+|["'«»„“”‘’()[\].,!?…;:]+$/g;
const URL_LIKE = /(https?:\/\/|www\.|\S+\.(com|org|net|io|dev|app)(\/|\b))/i;
const EMAIL_LIKE = /\S+@\S+\.\S+/;
const HANDLE_LIKE = /(^|\s)@\w+/;
const DIGITS_ONLY = /^[\d\s.,-]+$/;
const HAS_LETTER = /\p{L}/u;
const SENTENCE_PUNCT = /[.!?…;:,]/;
const UNSPACED = new Set(['zh', 'zh-Hans', 'ja', 'th']);
const MAX_CHARS = 100;
const MAX_WORDS = 5;
const MAX_GRAPHEMES = 12;
const MAX_RESULT_WORDS = 8; // phrase_mt heuristic (16 §2)
const RATE_LIMIT_PER_HOUR = 60; // uncached lookups per user
// 429 hardening. Two additional layers, both on UNCACHED lookups only:
const RATE_LIMIT_PER_MINUTE = 8; // per-user burst cap — typing bursts, not humans reading results
const GLOBAL_LIMIT_PER_HOUR = 600; // ALL users combined — protects the shared Azure F0 resource
// (each uncached lookup costs up to 2 Azure calls: dictionary + MT fallback)

// Script consistency (mirror of the registry's script map in src/constants/languages.ts).
// Only non-Latin scripts are listed; everything else defaults to Latin. If input has
// letters but none in the source language's script → wrong-direction, reject early.
const LANG_SCRIPT: Record<string, string> = {
  ar: 'Arab', fa: 'Arab', ur: 'Arab', bg: 'Cyrl', ru: 'Cyrl', uk: 'Cyrl',
  el: 'Grek', he: 'Hebr', hi: 'Deva', bn: 'Beng', ta: 'Taml', th: 'Thai',
  ja: 'Jpan', ko: 'Kore', 'zh-Hans': 'Hans',
};
const SCRIPT_RE: Record<string, RegExp> = {
  Latn: /\p{Script=Latin}/u, Arab: /\p{Script=Arabic}/u, Cyrl: /\p{Script=Cyrillic}/u,
  Grek: /\p{Script=Greek}/u, Hebr: /\p{Script=Hebrew}/u, Deva: /\p{Script=Devanagari}/u,
  Beng: /\p{Script=Bengali}/u, Taml: /\p{Script=Tamil}/u, Thai: /\p{Script=Thai}/u,
  Hans: /\p{Script=Han}/u, Kore: /\p{Script=Hangul}/u,
  Jpan: /\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}/u,
};
const scriptFor = (code: string): string => LANG_SCRIPT[code] ?? LANG_SCRIPT[code.split('-')[0]] ?? 'Latn';

function normalize(raw: string): { normalized: string; display: string } {
  const cleaned = raw
    .normalize('NFC')
    .replace(CONTROL_CHARS, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(WRAP_PUNCT, '')
    .trim();
  return { normalized: cleaned.toLowerCase(), display: cleaned };
}

function gate(raw: string, sourceLang: string): { ok: true; normalized: string; display: string } | { ok: false; reason: RejectReason } {
  const { normalized, display } = normalize(raw);
  if (normalized === '') return { ok: false, reason: 'empty' };
  if (normalized.length > MAX_CHARS) return { ok: false, reason: 'too_long' };
  if (URL_LIKE.test(normalized) || EMAIL_LIKE.test(normalized) || HANDLE_LIKE.test(normalized)) return { ok: false, reason: 'not_a_word' };
  if (DIGITS_ONLY.test(normalized) || !HAS_LETTER.test(normalized)) return { ok: false, reason: 'not_a_word' };
  if (SENTENCE_PUNCT.test(normalized)) return { ok: false, reason: 'sentence_like' };
  const scriptRe = SCRIPT_RE[scriptFor(sourceLang)];
  if (scriptRe && !scriptRe.test(normalized)) return { ok: false, reason: 'wrong_script' };
  const unspaced = UNSPACED.has(sourceLang) || UNSPACED.has(sourceLang.split('-')[0]);
  if (unspaced) {
    const count = [...new Intl.Segmenter(sourceLang, { granularity: 'grapheme' }).segment(normalized)].length;
    if (count > MAX_GRAPHEMES) return { ok: false, reason: 'too_long' };
  } else if (normalized.split(' ').length > MAX_WORDS) {
    return { ok: false, reason: 'too_many_words' };
  }
  return { ok: true, normalized, display };
}

// ── Azure ─────────────────────────────────────────────────────────────────────
const AZURE_BASE = 'https://api.cognitive.microsofttranslator.com';

function azureHeaders(): HeadersInit {
  return {
    'Ocp-Apim-Subscription-Key': Deno.env.get('AZURE_TRANSLATOR_KEY') ?? '',
    'Ocp-Apim-Subscription-Region': Deno.env.get('AZURE_TRANSLATOR_REGION') ?? '',
    'Content-Type': 'application/json',
  };
}

interface AzureSense {
  normalizedTarget: string;
  displayTarget: string;
  posTag: string;
  confidence: number;
  prefixWord: string;
  backTranslations: { normalizedText: string; displayText: string; numExamples: number; frequencyCount: number }[];
  // Result-quality gate (16 §2), evaluated PER SENSE — mirror of
  // src/domain/translation.ts#DictionarySense.
  quality?: 'unsaveable';
  qualityReason?: 'echo';
}

// 'busy' = Azure throttled US (429) — surfaced to the client as OUR 429 so it
// can show a "try again shortly" state and never auto-retry into the throttle.
async function dictionaryLookup(text: string, from: string, to: string): Promise<{ displaySource: string; senses: AzureSense[] } | 'error' | 'busy'> {
  const res = await fetch(`${AZURE_BASE}/dictionary/lookup?api-version=3.0&from=${from}&to=${to}`, {
    method: 'POST',
    headers: azureHeaders(),
    body: JSON.stringify([{ Text: text }]),
  });
  if (res.status === 429) return 'busy';
  if (!res.ok) return 'error';
  const [entry] = await res.json();
  const senses = ((entry?.translations ?? []) as AzureSense[]).sort((a, b) => b.confidence - a.confidence).slice(0, 5);
  return { displaySource: entry?.displaySource ?? text, senses };
}

async function mtTranslate(text: string, from: string, to: string): Promise<string | 'error' | 'busy'> {
  const res = await fetch(`${AZURE_BASE}/translate?api-version=3.0&from=${from}&to=${to}`, {
    method: 'POST',
    headers: azureHeaders(),
    body: JSON.stringify([{ Text: text }]),
  });
  if (res.status === 429) return 'busy';
  if (!res.ok) return 'error';
  const [entry] = await res.json();
  return entry?.translations?.[0]?.text ?? 'error';
}

// ── Row ↔ response mapping ────────────────────────────────────────────────────
// deno-lint-ignore no-explicit-any
function rowToOutcome(row: any): Record<string, unknown> {
  // Echo rows are stored rejected (so save_card blocks them) but still carry a
  // translation — surface them as a found-but-unsaveable card, not an empty state.
  const isEcho = row.gate_status === 'rejected' && row.gate_reason === 'echo' && row.translation != null;
  if (row.gate_status === 'rejected' && !isEcho) {
    return row.gate_reason === 'not_found' ? { status: 'not_found' } : { status: 'rejected', reason: row.gate_reason };
  }
  const primary: AzureSense = {
    normalizedTarget: (row.translation as string).toLowerCase(),
    displayTarget: row.translation,
    posTag: row.pos_tag ?? 'OTHER',
    confidence: Number(row.confidence ?? 0),
    prefixWord: row.prefix_word ?? '',
    backTranslations: row.back_translations ?? [],
  };
  // Result-quality gate, evaluated PER SENSE (2026-07-23 fix — was: once for the
  // whole result from `primary` alone). Senses render as independent cards (D10:
  // saving one never touches its siblings), so a bad sense must never poison a
  // sibling that's a real, distinct translation — e.g. "bobcat" (EN→RU) had an
  // untranslated-echo primary sense that wrongly blocked its valid second sense
  // ("рысь"). `isEcho` (from the MT-fallback rejected-echo row) only ever applies to
  // the single MT sense; a dictionary row's own senses are each checked against the
  // source independently. Mirror of src/domain/translation.ts#assessResultQuality.
  const withQuality = (s: AzureSense): AzureSense =>
    isEcho || s.normalizedTarget === row.source_text ? { ...s, quality: 'unsaveable', qualityReason: 'echo' } : s;
  const senses = [primary, ...((row.alt_translations ?? []) as AzureSense[])].map(withQuality);
  // Per-sense examples (2026-07-17): row.examples is a jsonb map keyed by the
  // sense's normalized target. LookupResult.examples stays the PRIMARY sense's
  // list (the search card attaches the example to the primary sense only);
  // legacy array rows (pre-migration) were primary-sense examples.
  const primaryExamples =
    row.examples == null
      ? null
      : Array.isArray(row.examples)
        ? row.examples
        : (row.examples[primary.normalizedTarget] ?? null);
  return {
    status: 'found',
    result: {
      translationId: row.id, // cache-row id — the save_card / examples key
      normalizedSource: row.source_text,
      displaySource: row.display_source,
      sourceLang: row.source_lang,
      targetLang: row.target_lang,
      senses,
      entryKind: row.entry_kind,
      provider: row.provider,
      ...(primaryExamples ? { examples: primaryExamples } : {}),
    },
  };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

// ── Handler ───────────────────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  // verify_jwt has validated the signature; require a real signed-in user
  // (anon key would pass verify_jwt but has no sub → cost-abuse vector).
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  let userId: string | null = null;
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    if (payload.role === 'authenticated' && typeof payload.sub === 'string') userId = payload.sub;
  } catch {
    /* fall through to 401 */
  }
  if (!userId) return json({ error: 'authentication required' }, 401);

  let body: { text?: string; from?: string; to?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'invalid JSON' }, 400);
  }
  const { text, from, to } = body;
  if (typeof text !== 'string' || typeof from !== 'string' || typeof to !== 'string' || from === to)
    return json({ error: 'text, from, to required (from ≠ to)' }, 400);

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  // Language validation (also picks up dictionary_with_en for the path choice).
  const { data: langs, error: langErr } = await supabase
    .from('languages')
    .select('code, dictionary_with_en')
    .in('code', [from, to]);
  if (langErr) return json({ error: 'language check failed' }, 500);
  if ((langs ?? []).length !== 2) return json({ error: 'unsupported language pair' }, 400);
  const hasEnglish = from === 'en' || to === 'en';

  // Tier-0 (authoritative re-run).
  const verdict = gate(text, from);
  if (!verdict.ok) return json({ status: 'rejected', reason: verdict.reason });

  // Cache (incl. negative cache).
  const { data: cached } = await supabase
    .from('translations_cache')
    .select('*')
    .eq('source_text', verdict.normalized)
    .eq('source_lang', from)
    .eq('target_lang', to)
    .maybeSingle();
  if (cached) return json(rowToOutcome(cached));

  // Rate limits — uncached lookups only (16 §2 cost protection). Three layers:
  // per-user/hour (abuse), per-user/minute (typing
  // bursts — 60/hr alone allowed all 60 inside one minute), and a GLOBAL
  // hourly budget so the whole user base can't push the shared Azure F0
  // resource into throttling (one throttled resource takes search down for
  // EVERYONE).
  const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const minuteAgo = new Date(Date.now() - 60 * 1000).toISOString();
  const countEvents = async (opts: { user?: string; since: string }) => {
    let q = supabase
      .from('study_events')
      .select('id', { count: 'exact', head: true })
      .eq('event', 'lookup_uncached')
      .gte('occurred_at', opts.since);
    if (opts.user) q = q.eq('user_id', opts.user);
    const { count } = await q;
    return count ?? 0;
  };
  if ((await countEvents({ user: userId, since: minuteAgo })) >= RATE_LIMIT_PER_MINUTE)
    return json({ error: 'rate limit exceeded' }, 429);
  if ((await countEvents({ user: userId, since: hourAgo })) >= RATE_LIMIT_PER_HOUR)
    return json({ error: 'rate limit exceeded' }, 429);
  if ((await countEvents({ since: hourAgo })) >= GLOBAL_LIMIT_PER_HOUR)
    return json({ error: 'translation service busy' }, 429);

  // Dictionary-first (X↔en pairs only; non-en pairs are deferred per 16 §1).
  // deno-lint-ignore no-explicit-any
  let row: Record<string, any> = {
    source_text: verdict.normalized,
    display_source: verdict.display,
    source_lang: from,
    target_lang: to,
  };

  let resolved = false;
  if (hasEnglish) {
    const dict = await dictionaryLookup(verdict.normalized, from, to);
    if (dict === 'busy') return json({ error: 'translation service busy' }, 429);
    if (dict === 'error') return json({ error: 'translation service unavailable' }, 503);
    if (dict.senses.length > 0) {
      const [primary, ...alts] = dict.senses;
      row = {
        ...row,
        display_source: dict.displaySource,
        translation: primary.displayTarget,
        pos_tag: primary.posTag,
        prefix_word: primary.prefixWord || null,
        confidence: primary.confidence,
        alt_translations: alts,
        back_translations: primary.backTranslations,
        entry_kind: verdict.normalized.includes(' ') ? 'phrase' : 'word',
        gate_status: 'allowed',
        provider: 'azure_dictionary',
      };
      resolved = true;
    }
  }

  if (!resolved) {
    // Constrained MT fallback (16 §2): compositional phrases the dictionary lacks.
    const mt = await mtTranslate(verdict.display, from, to);
    if (mt === 'busy') return json({ error: 'translation service busy' }, 429);
    if (mt === 'error') return json({ error: 'translation service unavailable' }, 503);
    // Identity-echo, generalized to ANY length (was: only >3-token sources). An MT
    // result identical to the input is an untranslated pass-through — persist it so
    // the card can DISPLAY it, but as gate_status='rejected'+reason 'echo' so save_card
    // structurally blocks it; rowToOutcome surfaces it as a found-but-unsaveable card.
    const isEcho = mt.normalize('NFC').trim().toLowerCase() === verdict.normalized;
    const validPhrase =
      mt.trim().length > 0 &&
      mt.split(/\s+/).length <= MAX_RESULT_WORDS &&
      !SENTENCE_PUNCT.test(mt.replace(WRAP_PUNCT, ''));
    if (isEcho) {
      row = { ...row, translation: mt, entry_kind: 'phrase_mt', gate_status: 'rejected', gate_reason: 'echo', provider: 'azure_mt' };
    } else if (validPhrase) {
      row = { ...row, translation: mt, entry_kind: 'phrase_mt', gate_status: 'allowed', provider: 'azure_mt' };
    } else {
      row = { ...row, gate_status: 'rejected', gate_reason: 'sentence_like', provider: 'azure_mt' };
    }
  }

  // Persist (negative results too) + count the uncached lookup.
  const { data: inserted, error: insErr } = await supabase
    .from('translations_cache')
    .upsert(row, { onConflict: 'source_text,source_lang,target_lang', ignoreDuplicates: true })
    .select()
    .maybeSingle();
  if (insErr) return json({ error: 'cache write failed' }, 500);
  await supabase.from('study_events').insert({ user_id: userId, event: 'lookup_uncached', props: { from, to } });

  // Upsert with ignoreDuplicates returns null on conflict — reselect.
  const final =
    inserted ??
    (
      await supabase
        .from('translations_cache')
        .select('*')
        .eq('source_text', verdict.normalized)
        .eq('source_lang', from)
        .eq('target_lang', to)
        .maybeSingle()
    ).data;
  if (!final) return json({ error: 'cache readback failed' }, 500);

  return json(rowToOutcome(final));
});
