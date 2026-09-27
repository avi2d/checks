#!/bin/sh
# lint-coverage: fail when oxlint silently skips a tracked TypeScript source.
set -eu

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT INT TERM

git ls-files -- '*.ts' '*.tsx' | LC_ALL=C sort > "$tmp/expected"
if ! [ -s "$tmp/expected" ]; then
  echo "lint-coverage: no tracked .ts/.tsx files"
  exit 0
fi

# Explicit paths bypass ignore files, so only an unscoped walk proves coverage.
if ! oxlint --debug=files > "$tmp/walk" 2> "$tmp/walk-error"; then
  echo "lint-coverage: oxlint could not walk the tree:"
  cat "$tmp/walk" "$tmp/walk-error"
  exit 2
fi
grep -E '\.tsx?$' "$tmp/walk" | LC_ALL=C sort > "$tmp/walked" || true

expected_count="$(wc -l < "$tmp/expected" | tr -d ' ')"
walked_count="$(grep -c . "$tmp/walked" || true)"

comm -23 "$tmp/expected" "$tmp/walked" > "$tmp/missing"
if [ -s "$tmp/missing" ]; then
  missing_count="$(wc -l < "$tmp/missing" | tr -d ' ')"
  echo "lint-coverage: oxlint skips ${missing_count}/${expected_count} tracked .ts/.tsx files; missing:"
  cat "$tmp/missing"
  exit 1
fi

echo "lint-coverage: ${walked_count}/${expected_count} tracked .ts/.tsx files"
