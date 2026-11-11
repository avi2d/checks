set -eo pipefail
bun src/delivery/docs-only.ts "$@" >> "$GITHUB_OUTPUT"
