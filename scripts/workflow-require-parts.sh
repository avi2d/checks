set -eo pipefail
test "$CHANGES" = success
test "$UNIT" = success
test "$STATIC" = success
test "$E2E" = success || { test "$E2E" = skipped && test "$E2E_SKIP" = true; }
