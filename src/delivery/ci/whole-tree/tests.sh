#!/usr/bin/env bash
set -euo pipefail
mkdir -p reports/whole-tree-run-tests
echo ready > reports/whole-tree-run-tests/manifest.txt
for tier in live pixel; do
  if [ -n "$(git ls-files "tests/$tier/*.test.ts" "tests/$tier/*.test.tsx")" ]; then
    bunx checks-test --tier="$tier" --junit="reports/whole-tree-run-tests/$tier.xml" || true
  fi
done
