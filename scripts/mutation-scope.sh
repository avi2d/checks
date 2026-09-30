#!/bin/sh
set -eu
# Usage: mutation-scope.sh <base> <baseline-mutation.json>
# A changed test also pulls in the sources its tests cover in the baseline
# report, and a unit test that imports a changed helper or names a changed
# fixture counts as changed, so a weakened helper is measured too.
source_file() { case "$1" in src/*.ts|src/*.js) return 0;; *) return 1;; esac; }
test_file() { case "$1" in tests/unit/*.test.ts) return 0;; *) return 1;; esac; }
test_tree_file() { case "$1" in tests/*) return 0;; *) return 1;; esac; }
base="$1"
baseline="$2"
tab="$(printf '\t')"
scope=""
tests=""
touched=""
while IFS= read -r file; do
  if source_file "$file"; then scope="$scope,$file"; fi
done <<EOF
$(git diff --name-only --diff-filter=ACMRT "$base...HEAD")
EOF
while IFS= read -r file; do
  if test_file "$file"; then tests="$tests,$file"; fi
  if test_tree_file "$file"; then touched="$touched,$file"; fi
done <<EOF
$(git diff --name-only --diff-filter=ACMRTD "$base...HEAD")
EOF
# A unit test that imports a changed helper or names a changed fixture is as changed as its own edit.
if [ -n "$touched" ]; then
  preloads=""
  if [ -f bunfig.toml ]; then
    preloads="$(awk '
      /^\[/ { table = $0 }
      table ~ /^\[test\]/ && /^[ \t]*preload[ \t]*=/ { reading = 1; sub(/^[^=]*=/, ""); array = index($0, "[") }
      reading {
        line = $0
        sub(/#.*/, "", line)
        while (match(line, /"[^"]*"/)) { printf "%s%s", sep, substr(line, RSTART + 1, RLENGTH - 2); sep = ","; line = substr(line, RSTART + RLENGTH) }
        if (!array || index(line, "]")) reading = 0
      }' bunfig.toml)"
  fi
  readers="$(git ls-files -- 'tests/*.ts' | awk -v changed="${touched#,}" -v preloads="$preloads" -f "$(dirname "$0")/mutation-readers.awk" | sort)"
  while IFS="$tab" read -r reader via; do
    if [ -n "$reader" ] && test_file "$reader"; then
      case ",$tests," in *",$reader,"*) ;;
        *) tests="$tests,$reader"; echo "mutation-scope: $reader reads $via" >&2;;
      esac
    fi
  done <<EOF
$readers
EOF
fi
# Incremental reuse leaves coveredBy empty on the mutants it restores, so the
# kills name the covering tests where the coverage no longer does.
if [ -n "$tests" ]; then
  if [ ! -f "$baseline" ]; then
    echo "mutation-scope: ${tests#,} changed, but no baseline report at $baseline says which sources they cover" >&2
    exit 1
  fi
  mapped="$(jq -r --arg tests "${tests#,}" '
    ($tests | split(",")) as $changed
    | ([.testFiles | to_entries[] | .key as $f | .value.tests[] | {key: .id, value: $f}] | from_entries) as $owner
    | .files | to_entries[]
      | select(.key | startswith("src/"))
      | ((.value.mutants | map(((.coveredBy // []) + (.killedBy // []))[]) | map($owner[.] // empty) | unique | map(select(IN($changed[])))) as $covering
        | select($covering | length > 0)
        | "\(.key)\t\($covering | join(" "))")
  ' "$baseline")"
  while IFS="$tab" read -r file via; do
    if [ -n "$file" ]; then
      case ",$scope," in *",$file,"*) ;;
        *) if git cat-file -e "HEAD:$file" 2>/dev/null; then scope="$scope,$file"; echo "mutation-scope: $file enters through $via" >&2; fi;;
      esac
    fi
  done <<EOF
$mapped
EOF
fi
# Each run mutates only the scope files its own tree has: Stryker cannot mutate a missing file.
head_scope=""
base_scope=""
while IFS= read -r file; do
  [ -f "$file" ] || continue
  head_scope="$head_scope,$file"
  if git cat-file -e "$base:$file" 2>/dev/null; then
    base_scope="$base_scope,$file"
  fi
done <<EOF
$(printf '%s' "$scope" | tr ',' '\n' | sed '/^$/d' | sort -u)
EOF
echo "SCOPE=${head_scope#,}"
echo "BASE_SCOPE=${base_scope#,}"
