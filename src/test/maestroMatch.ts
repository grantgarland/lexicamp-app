// Maestro's text matcher, reimplemented once and shared by every guard suite.
// Extracted 2026-08-03 from maestroSelectors.test.tsx so the rule cannot drift
// between suites — a second, subtly different copy would be worse than none.
//
// Source: `maestro.Filters.textMatches` (maestro-client 2.6.1, disassembled
// 2026-07-28). Kotlin:
//   regex.matches(text) || regex.pattern == text
//     || regex.matches(nlText) || regex.pattern == nlText     (nlText = '\n' → ' ')
// `Regex.matches()` is a WHOLE-STRING match, so a substring selector needs an
// explicit `.*`. Maestro is case-SENSITIVE; its `(?i)` inline flag is not valid
// in JS RegExp, so it is translated to the 'i' flag here.
export function maestroMatches(selector: string, text: string): boolean {
  const ci = selector.startsWith('(?i)');
  const body = ci ? selector.slice(4) : selector;
  const re = new RegExp(`^(?:${body})$`, ci ? 'i' : '');
  const nl = text.replace(/\n/g, ' ');
  return re.test(text) || body === text || re.test(nl) || body === nl;
}
