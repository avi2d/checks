set -eo pipefail
printf '%s' "$PACK" > "$RUNNER_TEMP/secrets-pack.json"
echo "CHECKS_SECRETS_PACK=$RUNNER_TEMP/secrets-pack.json" >> "$GITHUB_ENV"
