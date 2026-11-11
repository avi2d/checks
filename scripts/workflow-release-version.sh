set -eo pipefail
test "v$(bun -p "require('./package.json').version")" = "$GITHUB_REF_NAME"
