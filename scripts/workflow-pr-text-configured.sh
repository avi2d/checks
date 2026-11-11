set -eo pipefail
if [ -n "$PACK" ]; then
  echo "configured=true" >> "$GITHUB_OUTPUT"
else
  echo "configured=false" >> "$GITHUB_OUTPUT"
  message="pr-text scan skipped: no private pack is configured (CHECKS_SECRETS_PACK is unset), so this pull request's text was not scanned for private terms"
  echo "::notice::$message"
  echo "$message" >> "$GITHUB_STEP_SUMMARY"
fi
