#!/bin/sh
# lint-coverage: fail when oxlint silently skips a tracked TypeScript source.
# Usage: lint-coverage.sh [--type-aware]  (flags are forwarded to oxlint)
set -eu

bin="${OXLINT_BIN:-./node_modules/.bin/oxlint}"
if ! [ -x "$bin" ]; then
  bin="oxlint"
fi

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT INT TERM

git ls-files -- '*.ts' '*.tsx' | LC_ALL=C sort > "$tmp/expected"
if ! [ -s "$tmp/expected" ]; then
  echo "lint-coverage: no tracked .ts/.tsx files"
  exit 0
fi

# Explicit paths bypass ignore files, so only an unscoped walk proves coverage.
"$bin" "$@" --debug=files 2>/dev/null | LC_ALL=C sort > "$tmp/walked"
grep -E '\.tsx?$' "$tmp/walked" > "$tmp/walked-ts" || true
total="$("$bin" "$@" -f json 2>/dev/null | grep -o '"number_of_files": [0-9][0-9]*' | grep -o '[0-9][0-9]*' || true)"

expected_count="$(wc -l < "$tmp/expected" | tr -d ' ')"
walked_count="$(grep -c . "$tmp/walked-ts" || true)"

missing="$(comm -23 "$tmp/expected" "$tmp/walked-ts")"
if [ -n "$missing" ]; then
  echo "lint-coverage: oxlint skips ${walked_count}/${expected_count} tracked .ts/.tsx files (json reports ${total:-unknown}); missing:"
  printf '%s\n' "$missing"
  exit 1
fi

if [ -z "$total" ] || [ "$(wc -l < "$tmp/walked" | tr -d ' ')" != "$total" ]; then
  echo "lint-coverage: oxlint file listing disagrees with its json count (${total:-unparsed}); refusing green"
  exit 1
fi

echo "lint-coverage: ${walked_count}/${expected_count} tracked .ts/.tsx files"
