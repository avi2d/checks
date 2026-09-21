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
oxlint --debug=files 2>/dev/null | grep -E '\.tsx?$' | LC_ALL=C sort > "$tmp/walked" || true

expected_count="$(wc -l < "$tmp/expected" | tr -d ' ')"
walked_count="$(grep -c . "$tmp/walked" || true)"

missing="$(comm -23 "$tmp/expected" "$tmp/walked")"
if [ -n "$missing" ]; then
  echo "lint-coverage: oxlint skips ${walked_count}/${expected_count} tracked .ts/.tsx files; missing:"
  printf '%s\n' "$missing"
  exit 1
fi

echo "lint-coverage: ${walked_count}/${expected_count} tracked .ts/.tsx files"
