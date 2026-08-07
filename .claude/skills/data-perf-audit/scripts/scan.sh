#!/usr/bin/env bash
# Evidence gathering for the data-perf audit.
#
# Prints the raw facts the audit reasons over, so every run starts from the code
# as it is now rather than from a reference doc that may have gone stale. It
# makes no judgements — interpreting these numbers is the audit's job.
#
# Usage:  bash .claude/skills/data-perf-audit/scripts/scan.sh [app-root]
set -uo pipefail

ROOT="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)}"
SRC="$ROOT/src"

if [ ! -d "$SRC" ]; then
  echo "error: no src/ under $ROOT — pass the lexicamp-app root as \$1" >&2
  exit 1
fi

rg_or_grep() {
  if command -v rg >/dev/null 2>&1; then
    rg --no-heading --line-number "$@"
  else
    # -r recursive, -n line numbers, -E extended regex; args mirror rg's usage here.
    local pat="$1"; shift
    grep -rnE "$pat" --include='*.ts' --include='*.tsx' "$@"
  fi
}

hr() { printf '\n%s\n%s\n' "$1" "$(printf '%.0s─' $(seq 1 ${#1}))"; }

# Drop comment-only lines before counting call sites. This codebase comments
# heavily and names APIs in prose ("...breaks the `useMemo` in ProjectionCard"),
# so a naive grep -c reports calls that do not exist. An over-count here is
# worse than no count: it reads as "already handled" and the audit skips a real
# gap. Not a parser — it misses trailing comments and comment-block bodies that
# don't start with a marker — so treat these as close estimates, not proofs.
strip_comments() { grep -vE '^[[:space:]]*(//|\*|/\*)' "$@"; }
count_calls() { # count_calls <symbol-with-paren> <file...>
  local sym="$1"; shift
  strip_comments "$@" 2>/dev/null | grep -cF "$sym" 2>/dev/null; true
}

echo "data-perf-audit scan — $ROOT"
echo "generated: $(date '+%Y-%m-%d %H:%M')"

hr "1. Query keys in use"
echo "(the cache's surface area — each distinct root is a separately cached, separately invalidatable thing)"
rg_or_grep "queryKey: \[[[:space:]]*'" "$SRC" 2>/dev/null \
  | sed -E "s/.*queryKey: \[[[:space:]]*'([^']+)'.*/\1/" \
  | sort | uniq -c | sort -rn
echo "  (keys built from a variable — usePullToRefresh, outboxInit — are excluded; they target these same roots)"

hr "2. Invalidation fan-out per mutation"
echo "(what one write costs; a mutation invalidating several full-library keys is the pattern to question)"
# Attribute each invalidate to the nearest enclosing top-level function. Helpers
# that only invalidate (invalidateDeckReads) are reported under their own name;
# callers show a "+invalidateDeckReads" entry to mark the inherited cost.
awk '
  /^(export )?(async )?function [A-Za-z_]/ {
    if (count > 0) printf "  %-28s %d →%s\n", fn, count, keys
    fn = $0; sub(/.*function /, "", fn); sub(/[(<].*/, "", fn)
    count = 0; keys = ""
  }
  /invalidateQueries\(\{ queryKey: \[[[:space:]]*./ {
    k = $0; sub(/.*queryKey: \[[[:space:]]*./, "", k); sub(/.\].*/, "", k)
    keys = keys " " k; count++
  }
  /invalidateDeckReads\(qc\)/ { keys = keys " +invalidateDeckReads"; count++ }
  END { if (count > 0) printf "  %-28s %d →%s\n", fn, count, keys }
' "$SRC/query/hooks.ts" 2>/dev/null

hr "3. Surgical updates vs. blunt invalidation"
TS_FILES=$(find "$SRC" -name '*.ts' -o -name '*.tsx')
# shellcheck disable=SC2086
printf "  setQueryData / setQueriesData : %s\n" "$(strip_comments $TS_FILES 2>/dev/null | grep -cE 'setQuer(y|ies)Data\(' ; true)"
# shellcheck disable=SC2086
printf "  invalidateQueries             : %s\n" "$(strip_comments $TS_FILES 2>/dev/null | grep -cF 'invalidateQueries(' ; true)"
# shellcheck disable=SC2086
printf "  refetchQueries                : %s\n" "$(strip_comments $TS_FILES 2>/dev/null | grep -cF 'refetchQueries(' ; true)"
echo "  (a low setQueryData ratio means the app re-fetches to learn things it already knew)"

hr "4. Subscription narrowing"
# shellcheck disable=SC2086
printf "  useQuery({ select }) uses : %s\n" "$(strip_comments $TS_FILES 2>/dev/null | grep -cE '^[[:space:]]*select:' ; true)"
echo "  (zero means every consumer re-renders on any change to any word)"

hr "5. Derivation memoization"
for f in query/hooks.ts domain/derive.ts domain/projection.ts; do
  [ -f "$SRC/$f" ] || continue
  printf "  %-24s %5s lines, %2s useMemo(\n" "$f" \
    "$(wc -l < "$SRC/$f" | tr -d ' ')" \
    "$(count_calls 'useMemo(' "$SRC/$f")"
done
echo "  (comment-only lines excluded — this codebase names useMemo in prose, and an"
echo "   over-count here reads as 'already handled' and hides a real gap)"
echo "  ⚠️  Before calling a missing useMemo a finding: app.json sets"
echo "     experiments.reactCompiler, so this build is auto-memoized. Profile first."

hr "6. Full-library read paths"
echo "(DataSource methods that page an entire library-sized set, and how wide each row is)"
awk '
  /^  async [a-zA-Z]+\(/ { m = $0; sub(/^  async /, "", m); sub(/\(.*/, "", m) }
  /fetchAllPages</ && m != "" { printf "  %-16s (line %d)\n", m, NR; m = "" }
' "$SRC/data/supabase/SupabaseDataSource.ts" 2>/dev/null
printf "\n  paging constants: "
grep -hE 'const (PAGE_SIZE|MAX_PAGES) =' "$SRC/data/supabase/SupabaseDataSource.ts" 2>/dev/null | tr -d ';' | tr '\n' ' '
printf "\n  join column count: "
awk '/^const CARD_JOIN/,/;$/' "$SRC/data/supabase/SupabaseDataSource.ts" 2>/dev/null \
  | tr ',' '\n' | grep -c . | tr -d '\n'
echo " (CARD_JOIN — every one of these crosses the wire per card)"

hr "7. Persisted cache configuration"
echo "(everything persisted is paid for twice per session: stringify out, parse + revive in)"
grep -nE 'key:|maxAge|gcTime|buster|shouldDehydrateQuery|staleTime' "$SRC/query/queryClient.ts" 2>/dev/null | sed 's/^/  /'
if ! grep -q 'shouldDehydrateQuery' "$SRC/query/queryClient.ts" 2>/dev/null; then
  echo "  → no shouldDehydrateQuery filter: the ENTIRE cache is written to AsyncStorage"
fi

hr "8. List rendering"
echo "(which screens render word-scale lists, and with what — a long list under ScrollView"
echo " mounts every row; FlatList/FlashList bound it to what's visible)"
for f in "$SRC"/screens/*.tsx; do
  [ -f "$f" ] || continue
  prims=$(grep -oE '<(FlatList|FlashList|SectionList|ScrollView)' "$f" 2>/dev/null \
    | tr -d '<' | sort | uniq -c | awk '{printf "%s×%s ", $1, $2}')
  [ -n "$prims" ] && printf "  %-26s %s\n" "$(basename "$f")" "$prims"
done
echo "  (only the screens rendering the WORD library matter here — a 6-item settings"
echo "   list under ScrollView is not a finding)"

hr "Next"
cat <<'EOF'
  1. Read references/hot-spots.md — and correct it where it disagrees with the above.
  2. Measure before diagnosing (references/measuring.md): the ratio between a
     40-word and a 5,000-word library is the finding, not the code shape.
EOF
