set -eo pipefail
state=failure
description="the scan failed or did not run"
if [ "$CONFIGURED" = false ]; then
  state=success
  description="scan skipped: no private pack is configured (CHECKS_SECRETS_PACK is unset)"
elif [ "$CONFIGURED" = true ] && [ "$OUTCOME" = success ]; then
  state=success
  description="the scan passed"
fi
head=$(gh api "repos/$GITHUB_REPOSITORY/pulls/$NUMBER" --jq .head.sha)
gh api "repos/$GITHUB_REPOSITORY/statuses/$head" -f state="$state" -f description="$description" -f context=pr-text -f target_url="$GITHUB_SERVER_URL/$GITHUB_REPOSITORY/actions/runs/$GITHUB_RUN_ID" --silent
