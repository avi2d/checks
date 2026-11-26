#!/usr/bin/env bash
set -euo pipefail
mkdir -p reports/whole-tree-run-gates
bunx checks-lint --whole-tree > reports/whole-tree-run-gates/gates.log 2>&1 || true
