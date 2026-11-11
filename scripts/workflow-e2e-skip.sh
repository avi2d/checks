set -eo pipefail
bun scripts/e2e-skip.ts "$@" >> "$GITHUB_OUTPUT"
