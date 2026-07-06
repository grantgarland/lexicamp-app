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
type RejectReason = 'empty' | 'too_long' | 'too_many_words' | 'sentence_like' | 'not_a_word';

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
}

async function dictionaryLookup(text: string, from: string, to: string): Promise<{ displaySource: string; senses: AzureSense[] } | 'error'> {
  const res = await fetch(`${AZURE_BASE}/dictionary/lookup?api-version=3.0&from=${from}&to=${to}`, {
    method: 'POST',
    headers: azureHeaders(),
    body: JSON.stringify([{ Text: text }]),
  });
  if (!res.ok) return 'error';
  const [entry] = await res.json();
  const senses = ((entry?.translations ?? []) as AzureSense[]).sort((a, b) => b.confidence - a.confidence).slice(0, 5);
  return { displaySource: entry?.displaySource ?? text, senses };
}

async function mtTranslate(text: string, from: string, to: string): Promise<string | 'error'> {
  const res = await fetch(`${AZURE_BASE}/translate?api-version=3.0&from=${from}&to=${to}`, {
    method: 'POST',
    headers: azureHeaders(),
    body: JSON.stringify([{ Text: text }]),
  });
  if (!res.ok) return 'error';
  const [entry] = await res.json();
  return entry?.translations?.[0]?.text ?? 'error';
}

// ── Row ↔ response mapping ────────────────────────────────────────────────────
// deno-lint-ignore no-explicit-any
function rowToOutcome(row: any): Record<string, unknown> {
  if (row.gate_status === 'rejected') {
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
  return {
    status: 'found',
    result: {
      translationId: row.id, // cache-row id — the save_card / examples key
      normalizedSource: row.source_text,
      displaySource: row.display_source,
      sourceLang: row.source_lang,
      targetLang: row.target_lang,
      senses: [primary, ...((row.alt_translations ?? []) as AzureSense[])],
      entryKind: row.entry_kind,
      provider: row.provider,
      ...(row.examples ? { examples: row.examples } : {}),
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

  // Rate limit — uncached lookups only (16 §2 cost protection).
  const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count } = await supabase
    .from('study_events')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('event', 'lookup_uncached')
    .gte('occurred_at', hourAgo);
  if ((count ?? 0) >= RATE_LIMIT_PER_HOUR) return json({ error: 'rate limit exceeded' }, 429);

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
    if (mt === 'error') return json({ error: 'translation service unavailable' }, 503);
    const resultOk =
      mt.trim().length > 0 &&
      mt.split(/\s+/).length <= MAX_RESULT_WORDS &&
      !SENTENCE_PUNCT.test(mt.replace(WRAP_PUNCT, '')) &&
      !(verdict.normalized.split(' ').length > 3 && mt.toLowerCase() === verdict.normalized);
    if (resultOk) {
      row = {
        ...row,
        translation: mt,
        entry_kind: 'phrase_mt',
        gate_status: 'allowed',
        provider: 'azure_mt',
      };
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
