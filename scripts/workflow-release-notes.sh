set -eo pipefail
bun src/delivery/release-notes.ts "${GITHUB_REF_NAME#v}" "$RUNNER_TEMP/release-notes.md"
