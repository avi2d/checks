---
kind: reference
audience: consumers
---
# checks-ci

`checks-ci` runs one step of the workflows `checks-workflows --write` writes, so each step is a command of the kit rather than a script in the repository.

## What it checks

Each command runs one step and reads its inputs from the environment the step sets:

| Command | Runs | Reads |
| --- | --- | --- |
| `changes` | writes `docs-only` and `tests-only` to `GITHUB_OUTPUT`, plus `browser` when `PLAN_BROWSER` is true | `BASE_SHA`, `PLAN_BROWSER` |
| `draft-hold` | cancels its own run when a push to a draft pull request started it, and fails the job when the job outlives the cancel | `DRAFT`, `GH_TOKEN`, `WAIT_SECONDS` |
| `require-success` | fails unless every job the gate needs passed, or skipped where `SKIPS` allows | `RESULTS`, `SKIPS` |
| `commit-status` | posts a job's result as a commit status. `ci.yml` uses it on a dispatched run, and `pr-title.yml` uses it on pull request opens, reopens, pushes, and title edits to post the commitlint status | `JOB_STATUS`, `CONTEXT`, `HEAD_SHA`, `PULL_REQUEST`, `DESCRIPTION`, `ATTEMPTS`, `GH_TOKEN` |
| `held-runs` | deletes the pull request runs GitHub holds for approval on a branch's tip | `BRANCH`, `GH_TOKEN` |
| `playwright` | installs the browsers `BROWSERS` names with `install`, or their system packages with `install-deps` | `BROWSERS` |
| `preview-address` | reads the preview address of the branch | `PROJECT`, `BRANCH`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` |
| `preview-deploy` | deploys the preview | `PROJECT`, `BRANCH`, `DIRECTORY`, `WRANGLER_VERSION`, `COMMIT_HASH`, `COMMIT_MESSAGE`, `COMMIT_DIRTY`, `ORIGIN`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` |
| `preview-comment` | posts the preview link on the pull request | `PULL_REQUEST`, `MARKER`, `AUTHOR`, `ORIGIN`, `HEAD_SHA`, `GH_TOKEN` |
| `preview-remove` | deletes the branch's deployments and says so on the pull request | `PROJECT`, `BRANCH`, `PULL_REQUEST`, `MARKER`, `AUTHOR`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `GH_TOKEN` |
| `pages-deploy` | deploys the built pages | `PROJECT`, `BRANCH`, `DIRECTORY`, `WRANGLER_VERSION`, `COMMIT_HASH`, `COMMIT_MESSAGE`, `COMMIT_DIRTY`, `ADDRESS`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` |
| `pages-served` | waits until the origin serves every built file as built | `ORIGIN`, `DIRECTORY`, `ATTEMPTS` |
| `pages-staged-commit` | reads the commit the Pages project serves | `DEPLOY_KEY`, `PROJECT`, `BRANCH`, `WORKFLOW`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `GH_TOKEN` |
| `pages-publish` | pushes the build to the production repository | `DEPLOY_KEY`, `SITE_PATH`, `DIRECTORY`, `REPOSITORY`, `CNAME`, `BRANCH`, `COMMIT_MESSAGE`, `SOURCE_SHA` |
| `lighthouse` | audits each page and writes the median scores to the job summary | `SITE`, `REPORTS`, `RUNS`, `CHROME`, `PAGES`, `ORIGIN`, `LIGHTHOUSE` |
| `secrets-pack` | writes the private secrets pack to a file and exports its path as `CHECKS_SECRETS_PACK`, or with `IF_MISSING` `skip` writes `configured=false` to `GITHUB_OUTPUT` when `PACK` is empty | `PACK`, `IF_MISSING`, `RUNNER_TEMP`, `GITHUB_ENV`, `GITHUB_STEP_SUMMARY` |
| `test` | runs `bun run test` when `CHECK_RELEASE` is `true`, and `bunx checks-test --pr` when it is `false` or unset, appending `--tier=<tier>` from `TEST_TIER` when set | `CHECK_RELEASE`, `TEST_TIER` |
| `release-version` | fails unless `TAG` is `v` and the version the manifest holds, and writes `version` to `GITHUB_OUTPUT` | `PACKAGE_PATH`, `TAG` |
| `mutation` | with `score`, writes the score of `reports/mutation/mutation.json` to the job summary, and with `shards`, splits the tree into `SHARDS` shard globs with `checks-mutation-scope` and writes them as `shards` to `GITHUB_OUTPUT` | `SHARDS`, `RUNNER_TEMP`, `GITHUB_STEP_SUMMARY`, `GITHUB_OUTPUT` |
| `github-release` | creates the GitHub release of a tag with the notes file, or updates the one that exists, and marks it latest only when its tag is the highest | `TAG`, `REF_TYPE`, `NOTES_FILE`, `GH_TOKEN` |

When `PLAN_BROWSER` is true, `changes` logs which routes each changed path reaches or why the browser must walk every route.
It writes `browser=false` when no route is reached or the change is confined to TypeScript files under `tests/unit/` and `tests/e2e/`.
The tests-only rule includes helpers under those directories and holds with or without `browserRoutes`.
A change to `checks.config.ts` also counts as tests-only when it changes only reach map entries and every other changed path is under those test directories.
The command compares the loaded settings at the merge base and the head.
When either config cannot load or another setting changes, the config makes the change full.

`lighthouse` installs the Lighthouse the kit pins unless `LIGHTHOUSE` names one.

## What it reads

It reads the command from its first argument and the inputs from the environment.
The commands that call GitHub read `GITHUB_REPOSITORY` and `GH_TOKEN`.

## Arguments

```sh
checks-ci <command>
checks-ci playwright install
checks-ci pages-publish guard
checks-ci pages-publish publish
```

## Exit codes

| Code | When |
| --- | --- |
| 0 | the step passed |
| 1 | the step failed, and a thrown failure prints as an `::error::` annotation |
| 2 | the command is not one `checks-ci` takes |

## Sample output

```
changes: 4 changed file(s), docs-only=false, tests-only=false
```

## When it runs

The workflows and the two actions `checks-workflows --write` writes call `bunx checks-ci <command>` in their steps.

## Related topics

- [checks-workflows](checks-workflows.md)
