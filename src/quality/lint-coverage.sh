#!/bin/sh
# lint-coverage: fail when oxlint silently skips a tracked TypeScript source,
# or when tsconfig.json's program silently drops the ts-reset rules.
set -eu

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT INT TERM

git ls-files -- '*.ts' '*.tsx' '*.astro' | LC_ALL=C sort > "$tmp/expected"
if ! [ -s "$tmp/expected" ]; then
  echo "lint-coverage: no tracked .ts/.tsx/.astro files"
  exit 0
fi

# Explicit paths bypass ignore files, so only an unscoped walk proves coverage.
if ! oxlint --debug=files > "$tmp/walk" 2> "$tmp/walk-error"; then
  echo "lint-coverage: oxlint could not walk the tree:"
  cat "$tmp/walk" "$tmp/walk-error"
  exit 2
fi
grep -E '[.]tsx?$|[.]astro$' "$tmp/walk" | LC_ALL=C sort > "$tmp/walked" || true

expected_count="$(wc -l < "$tmp/expected" | tr -d ' ')"
walked_count="$(grep -c . "$tmp/walked" || true)"
status=0

comm -23 "$tmp/expected" "$tmp/walked" > "$tmp/missing"
if [ -s "$tmp/missing" ]; then
  missing_count="$(wc -l < "$tmp/missing" | tr -d ' ')"
  echo "lint-coverage: oxlint skips ${missing_count}/${expected_count} tracked .ts/.tsx/.astro files; missing:"
  cat "$tmp/missing"
  status=1
else
  echo "lint-coverage: ${walked_count}/${expected_count} tracked .ts/.tsx/.astro files"
fi

if ! grep -qE '[.]tsx?$' "$tmp/expected"; then
  echo "lint-coverage: no tracked .ts/.tsx files, so no program to hold the ts-reset rules"
  exit "$status"
fi

if ! [ -f tsconfig.json ]; then
  echo "lint-coverage: no tsconfig.json, so no program to hold the ts-reset rules"
  exit "$status"
fi

if ! tsc --listFilesOnly -p tsconfig.json > "$tmp/program" 2> "$tmp/program-error"; then
  echo "lint-coverage: tsc could not list the program tsconfig.json builds:"
  # tsc lists each file of the program as an absolute path beside its errors.
  grep -v '^/' "$tmp/program" || true
  cat "$tmp/program-error"
  if [ "$status" -eq 1 ]; then
    exit 1
  fi
  exit 2
fi

dropped=""
for rule in is-array json-parse; do
  if ! grep -q "/@total-typescript/ts-reset/dist/${rule}\.d\.ts\$" "$tmp/program"; then
    dropped="${dropped} ${rule}"
  fi
done
if [ -n "$dropped" ]; then
  echo "lint-coverage: the program tsconfig.json builds drops the ts-reset rules:${dropped}"
  echo "  extend @avi2dg/checks/tsconfig.effect.json, and set files or include in tsconfig.json but not both"
  exit 1
fi

echo "lint-coverage: the program tsconfig.json builds holds the ts-reset rules is-array and json-parse"
exit "$status"
