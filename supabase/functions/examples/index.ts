// examples — lazy dictionary/examples fetch + cache (16 §3 / backlog 1.6c).
// Called on first card-detail view; example sentences are persisted onto the
// translations_cache row, so each (term, translation, SENSE) triple costs Azure
// chars exactly once. Keyed by cache row id — the client can only request
// examples for content that already passed the capture gate.
//
// Per-sense (Casey bug, 2026-07-17): `examples` is a jsonb MAP keyed by the
// sense's normalized target term ({ "집": [...], "주택": [...] }). The client
// passes `targetTerm` for non-primary senses; omitted → the primary sense.
// The Azure call sends the SENSE's target term — the old shape generated one
// shared example set against the primary sense only.
// @ts-ignore -- Deno npm: specifier resolved at runtime, not by the TS server.
import { createClient } from 'npm:@supabase/supabase-js@2';

// Deno is provided by the edge runtime, not the TS server.
declare const Deno: {
  env: { get(key: string): string | undefined };
  serve(handler: (req: Request) => Response | Promise<Response>): void;
};

const AZURE_BASE = 'https://api.cognitive.microsofttranslator.com';

// Rate limits — UNCACHED generations only (audit item 14, 2026-08-06). Same
// three-layer shape as translate/, and counted the same way: one
// 'examples_generated' study_event per Azure call, read back through the
// existing study_events (event, occurred_at) index.
//
// Why the ceilings are higher than translate's 8/min + 60/hr: an examples fetch
// is triggered by opening a word's detail, not by typing, so the honest burst is
// "user flicks through their word list" rather than "user is mid-keystroke".
// Each (term, sense) pair also costs Azure exactly once EVER and is then shared
// by every user, so the steady state decays toward zero as the cache fills —
// unlike translate, where every new phrase is a fresh charge.
const RATE_LIMIT_PER_MINUTE = 12; // per-user burst
const RATE_LIMIT_PER_HOUR = 120; // per-user abuse ceiling
// Global budget for THIS function. Deliberately half of translate's 600/hr: the
// two share one Azure F0 resource and one key, so the combined worst case is
// 900/hr — still well inside F0's band, and translate is the path that must not
// starve (a failed lookup is a dead end; a failed examples fetch is a word
// detail without sentences, which the client already renders).
const GLOBAL_LIMIT_PER_HOUR = 300;

interface UsageExample {
  sourcePrefix: string;
  sourceTerm: string;
  sourceSuffix: string;
  targetPrefix: string;
  targetTerm: string;
  targetSuffix: string;
}

type ExamplesMap = Record<string, UsageExample[]>;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const normTerm = (s: string): string => s.normalize('NFC').trim().toLowerCase();

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  // Same auth stance as translate/: verify_jwt validated the signature; require
  // a real user (anon key has no authenticated sub).
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  let userId: string | null = null;
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    if (payload.role === 'authenticated' && typeof payload.sub === 'string') userId = payload.sub;
  } catch {
    /* fall through */
  }
  if (!userId) return json({ error: 'authentication required' }, 401);

  let body: { translationId?: string; targetTerm?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'invalid JSON' }, 400);
  }
  if (typeof body.translationId !== 'string') return json({ error: 'translationId required' }, 400);
  if (body.targetTerm != null && typeof body.targetTerm !== 'string') return json({ error: 'targetTerm must be a string' }, 400);

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  const { data: row, error } = await supabase
    .from('translations_cache')
    .select('id, source_text, translation, source_lang, target_lang, gate_status, provider, examples, alt_translations')
    .eq('id', body.translationId)
    .maybeSingle();
  if (error) return json({ error: 'lookup failed' }, 500);
  if (!row || row.gate_status !== 'allowed') return json({ error: 'unknown translation' }, 404);

  // Resolve + validate the requested sense against the row's actual senses —
  // the client can't make us spend Azure chars on arbitrary strings.
  const primaryKey = normTerm((row.translation as string | null) ?? '');
  const altKeys = ((row.alt_translations ?? []) as { normalizedTarget?: string; displayTarget?: string }[]).map((s) =>
    normTerm(s.normalizedTarget ?? s.displayTarget ?? ''),
  );
  const senseKey = body.targetTerm != null && body.targetTerm.trim() !== '' ? normTerm(body.targetTerm) : primaryKey;
  if (senseKey !== primaryKey && !altKeys.includes(senseKey)) return json({ error: 'unknown sense' }, 400);

  // Legacy array rows (pre per-sense migration) were primary-sense examples.
  const map: ExamplesMap =
    row.examples == null ? {} : Array.isArray(row.examples) ? { [primaryKey]: row.examples as UsageExample[] } : (row.examples as ExamplesMap);

  // Cache hit — free.
  const cached = map[senseKey];
  if (cached) return json({ examples: cached });

  // dictionary/examples only exists for dictionary-verified pairs; phrase_mt
  // entries get an empty list (never free-MT example generation — 16 edge cases).
  let examples: UsageExample[] = [];
  if (row.provider === 'azure_dictionary') {
    // Rate limits go HERE, not at the top of the handler: everything above this
    // point is free (a cache hit, or a phrase_mt row that never calls Azure), and
    // throttling a free path would only break browsing. This is the first line
    // that can spend money.
    const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const minuteAgo = new Date(Date.now() - 60 * 1000).toISOString();
    const countEvents = async (opts: { user?: string; since: string }) => {
      let q = supabase
        .from('study_events')
        .select('id', { count: 'exact', head: true })
        .eq('event', 'examples_generated')
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
      return json({ error: 'examples service busy' }, 429);

    const res = await fetch(
      `${AZURE_BASE}/dictionary/examples?api-version=3.0&from=${row.source_lang}&to=${row.target_lang}`,
      {
        method: 'POST',
        headers: {
          'Ocp-Apim-Subscription-Key': Deno.env.get('AZURE_TRANSLATOR_KEY') ?? '',
          'Ocp-Apim-Subscription-Region': Deno.env.get('AZURE_TRANSLATOR_REGION') ?? '',
          'Content-Type': 'application/json',
        },
        // The SENSE's normalized target — the whole point of the per-sense fix.
        body: JSON.stringify([{ Text: row.source_text, Translation: senseKey }]),
      },
    );
    // Same blind spot the translate function had (2026-08-05): a bare 429/503
    // told the logs nothing about WHY Azure refused. This function shares
    // AZURE_TRANSLATOR_KEY with translate, so a dead key takes both down at
    // once — and the log line is what says so. Never logs headers: the
    // subscription key is in them.
    if (!res.ok) {
      let code: unknown = null;
      let message = '';
      try {
        const body = await res.clone().json();
        code = body?.error?.code ?? null;
        message = String(body?.error?.message ?? '').slice(0, 200);
      } catch {
        message = (await res.clone().text().catch(() => '')).slice(0, 200);
      }
      console.error(JSON.stringify({
        at: 'azure', op: 'dictionary/examples',
        kind: res.status === 429 ? 'busy' : 'error',
        httpStatus: res.status, azureCode: code, azureMessage: message,
      }));
      if (res.status === 429) return json({ error: 'examples service busy' }, 429);
      return json({ error: 'examples service unavailable' }, 503);
    }
    const [entry] = await res.json();
    examples = (entry?.examples ?? []).slice(0, 5).map((e: Record<string, string>) => ({
      sourcePrefix: e.sourcePrefix ?? '',
      sourceTerm: e.sourceTerm ?? '',
      sourceSuffix: e.sourceSuffix ?? '',
      targetPrefix: e.targetPrefix ?? '',
      targetTerm: e.targetTerm ?? '',
      targetSuffix: e.targetSuffix ?? '',
    }));
  }

  // Merge-write the one sense. (Two concurrent first-views of DIFFERENT senses
  // could race this read-modify-write; worst case the loser's set is refetched
  // on next view — acceptable at this scale.)
  const { error: upErr } = await supabase
    .from('translations_cache')
    .update({ examples: { ...map, [senseKey]: examples } })
    .eq('id', row.id);
  if (upErr) return json({ error: 'cache write failed' }, 500);

  // The rate-limit counter. Written only when Azure was actually called, so the
  // free paths above (cache hit, phrase_mt) never consume anyone's budget. Logged
  // after the cache write, mirroring translate/'s ordering: a generation that
  // failed to persist would otherwise be charged to the user while still
  // refetching on their next view.
  if (row.provider === 'azure_dictionary') {
    await supabase
      .from('study_events')
      .insert({ user_id: userId, event: 'examples_generated', props: { translation_id: row.id, sense: senseKey } });
  }

  return json({ examples });
});
