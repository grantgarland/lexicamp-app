// examples — lazy dictionary/examples fetch + cache (16 §3 / backlog 1.6c).
// Called on first card-detail view; example sentences are persisted onto the
// translations_cache row, so each (term, translation) pair costs Azure chars
// exactly once. Keyed by cache row id — the client can only request examples
// for content that already passed the capture gate.
// @ts-ignore -- Deno npm: specifier resolved at runtime, not by the TS server.
import { createClient } from 'npm:@supabase/supabase-js@2';

// Deno is provided by the edge runtime, not the TS server.
declare const Deno: {
  env: { get(key: string): string | undefined };
  serve(handler: (req: Request) => Response | Promise<Response>): void;
};

const AZURE_BASE = 'https://api.cognitive.microsofttranslator.com';

interface UsageExample {
  sourcePrefix: string;
  sourceTerm: string;
  sourceSuffix: string;
  targetPrefix: string;
  targetTerm: string;
  targetSuffix: string;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

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

  let body: { translationId?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'invalid JSON' }, 400);
  }
  if (typeof body.translationId !== 'string') return json({ error: 'translationId required' }, 400);

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  const { data: row, error } = await supabase
    .from('translations_cache')
    .select('id, source_text, translation, source_lang, target_lang, gate_status, provider, examples')
    .eq('id', body.translationId)
    .maybeSingle();
  if (error) return json({ error: 'lookup failed' }, 500);
  if (!row || row.gate_status !== 'allowed') return json({ error: 'unknown translation' }, 404);

  // Cache hit — free.
  if (row.examples) return json({ examples: row.examples });

  // dictionary/examples only exists for dictionary-verified pairs; phrase_mt
  // entries get an empty list (never free-MT example generation — 16 edge cases).
  if (row.provider !== 'azure_dictionary') {
    await supabase.from('translations_cache').update({ examples: [] }).eq('id', row.id);
    return json({ examples: [] });
  }

  const res = await fetch(
    `${AZURE_BASE}/dictionary/examples?api-version=3.0&from=${row.source_lang}&to=${row.target_lang}`,
    {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': Deno.env.get('AZURE_TRANSLATOR_KEY') ?? '',
        'Ocp-Apim-Subscription-Region': Deno.env.get('AZURE_TRANSLATOR_REGION') ?? '',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify([{ Text: row.source_text, Translation: (row.translation as string).toLowerCase() }]),
    },
  );
  if (!res.ok) return json({ error: 'examples service unavailable' }, 503);
  const [entry] = await res.json();
  const examples: UsageExample[] = (entry?.examples ?? []).slice(0, 5).map((e: Record<string, string>) => ({
    sourcePrefix: e.sourcePrefix ?? '',
    sourceTerm: e.sourceTerm ?? '',
    sourceSuffix: e.sourceSuffix ?? '',
    targetPrefix: e.targetPrefix ?? '',
    targetTerm: e.targetTerm ?? '',
    targetSuffix: e.targetSuffix ?? '',
  }));

  const { error: upErr } = await supabase.from('translations_cache').update({ examples }).eq('id', row.id);
  if (upErr) return json({ error: 'cache write failed' }, 500);

  return json({ examples });
});
