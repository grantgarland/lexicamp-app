// Drift tripwire for the Tier-0 capture-gate MIRROR (16 §2). The rules in
// src/domain/capture.ts are hand-mirrored in supabase/functions/translate/index.ts
// (Deno — not importable from jest), and the registry's script map is hand-mirrored
// as the edge fn's LANG_SCRIPT/SCRIPT_RE tables. "Change both or neither" was
// previously enforced only by comments; this suite makes CI fail when either side
// drifts, by parsing the edge-function SOURCE and comparing:
//   1. detector/normalization regex literals — byte-identical to capture.ts
//   2. rule constants (maxChars/maxWords/maxGraphemes, unspaced set)
//   3. LANG_SCRIPT vs the registry (every non-Latin language, both directions)
//   4. SCRIPT_RE per-script behavior vs textHasScript (probe characters)
import { readFileSync } from 'fs';
import { join } from 'path';

import { LANGUAGES, textHasScript, type ScriptTag } from '@/constants/languages';

import { captureRulesFor, LANG_CAPTURE_RULES } from '../capture';

const edgeSrc = readFileSync(join(__dirname, '../../../supabase/functions/translate/index.ts'), 'utf8');
const captureSrc = readFileSync(join(__dirname, '../capture.ts'), 'utf8');

/** Extract `const NAME = /…/flags;` from a source file. */
function regexLiteral(src: string, name: string): string {
  const m = src.match(new RegExp(`const ${name} = (\\/(?:[^\\/\\\\\\n]|\\\\.)+\\/[a-z]*);`));
  if (!m) throw new Error(`regex literal ${name} not found`);
  return m[1]!;
}

/** Extract `const NAME = <number>;` from a source file. */
function numberLiteral(src: string, name: string): number {
  const m = src.match(new RegExp(`const ${name} = (\\d+);`));
  if (!m) throw new Error(`number literal ${name} not found`);
  return Number(m[1]);
}

describe('edge-fn gate mirrors capture.ts (change both or neither)', () => {
  it.each(['CONTROL_CHARS', 'WRAP_PUNCT', 'URL_LIKE', 'EMAIL_LIKE', 'HANDLE_LIKE', 'DIGITS_ONLY', 'HAS_LETTER', 'SENTENCE_PUNCT'])(
    'regex literal %s is byte-identical in both sources',
    (name) => {
      expect(regexLiteral(edgeSrc, name)).toBe(regexLiteral(captureSrc, name));
    },
  );

  it('rule constants match DEFAULT_RULES', () => {
    const rules = captureRulesFor('en');
    expect(numberLiteral(edgeSrc, 'MAX_CHARS')).toBe(rules.maxChars);
    expect(numberLiteral(edgeSrc, 'MAX_WORDS')).toBe(rules.maxWords);
    expect(numberLiteral(edgeSrc, 'MAX_GRAPHEMES')).toBe(rules.maxGraphemes);
  });

  it('UNSPACED set matches LANG_CAPTURE_RULES', () => {
    const m = edgeSrc.match(/const UNSPACED = new Set\(\[([^\]]*)\]\)/);
    expect(m).not.toBeNull();
    const edgeUnspaced = new Set(
      m![1]!.split(',').map((s) => s.trim().replace(/['"]/g, '')).filter(Boolean),
    );
    const clientUnspaced = new Set(Object.keys(LANG_CAPTURE_RULES).filter((k) => LANG_CAPTURE_RULES[k]?.unspaced));
    expect(edgeUnspaced).toEqual(clientUnspaced);
  });
});

describe('edge-fn LANG_SCRIPT/SCRIPT_RE mirror the language registry', () => {
  // Parse the LANG_SCRIPT object literal out of the edge source.
  const langScriptBlock = edgeSrc.match(/const LANG_SCRIPT: Record<string, string> = \{([\s\S]*?)\};/);
  const langScript: Record<string, string> = {};
  for (const [, code, script] of langScriptBlock![1]!.matchAll(/['"]?([\w-]+)['"]?:\s*'(\w+)'/g)) {
    langScript[code!] = script!;
  }
  const scriptFor = (code: string): string => langScript[code] ?? langScript[code.split('-')[0]!] ?? 'Latn';

  it('every registry language resolves to its registry script', () => {
    for (const lang of LANGUAGES) {
      expect({ code: lang.code, script: scriptFor(lang.code) }).toEqual({ code: lang.code, script: lang.script });
    }
  });

  it('every LANG_SCRIPT entry exists in the registry with the same script', () => {
    for (const [code, script] of Object.entries(langScript)) {
      const row = LANGUAGES.find((l) => l.code === code || l.code.split('-')[0] === code);
      expect(row).toBeDefined();
      expect(script).toBe(row!.script);
    }
  });

  // One probe character per script; both sides must classify it identically.
  const PROBES: Record<ScriptTag, string> = {
    Latn: 'a', Arab: 'ا', Cyrl: 'б', Grek: 'α', Hebr: 'ש', Deva: 'क',
    Beng: 'অ', Taml: 'அ', Thai: 'ก', Hans: '汉', Jpan: 'あ', Kore: '한',
  };

  it('SCRIPT_RE agrees with textHasScript on probe characters', () => {
    const block = edgeSrc.match(/const SCRIPT_RE: Record<string, RegExp> = \{([\s\S]*?)\};/);
    expect(block).not.toBeNull();
    const entries = [...block![1]!.matchAll(/(\w+):\s*(\/(?:[^/\\\n]|\\.)+\/[a-z]*)/g)];
    const scriptRe: Record<string, RegExp> = {};
    for (const [, tag, lit] of entries) {
      const m = lit!.match(/^\/(.*)\/([a-z]*)$/s);
      scriptRe[tag!] = new RegExp(m![1]!, m![2]);
    }
    const tags = Object.keys(PROBES) as ScriptTag[];
    expect(Object.keys(scriptRe).sort()).toEqual([...tags].sort());
    for (const tag of tags) {
      for (const probeTag of tags) {
        const probe = PROBES[probeTag];
        expect({ tag, probeTag, matches: scriptRe[tag]!.test(probe) }).toEqual({
          tag,
          probeTag,
          matches: textHasScript(probe, tag),
        });
      }
    }
  });
});
