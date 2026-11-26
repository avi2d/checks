#!/usr/bin/env bash
set -euo pipefail
args=(--mutation reports/mutation/mutation-baseline-full/mutation.json)
for tier in live pixel; do
  if [ -n "$(git ls-files "tests/$tier/*.test.ts" "tests/$tier/*.test.tsx")" ]; then
    args+=(--tests "reports/whole-tree-run-tests/$tier.xml")
  fi
done
if [ "$GATES_RESULT" = success ]; then
  args+=(--gates reports/whole-tree-run-gates/gates.log)
fi
bunx checks-whole-tree-run "${args[@]}"
