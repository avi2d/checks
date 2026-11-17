---
kind: reference
audience: consumers
---
# checks-ci

`checks-ci` runs one step of the workflows `checks-workflows --write --full` writes, so each step is a command of the kit rather than a script in the repository.

## What it checks

Each command runs one step and reads its inputs from the environment the step sets:

| Command | Runs | Reads |
| --- | --- | --- |
| `changes` | classifies the change as docs-only, tests-only or full and writes `docs-only` and `tests-only` to `GITHUB_OUTPUT` | `BASE_SHA` |
| `draft-hold` | cancels its own run when a push to a draft pull request started it, and fails the job when the job outlives the cancel | `DRAFT`, `GH_TOKEN`, `WAIT_SECONDS` |
| `require-success` | fails unless every job the gate needs passed, or skipped where `SKIPS` allows | `RESULTS`, `SKIPS` |
| `commit-status` | posts a job's result as a commit status, since GitHub keeps a dispatched run's checks off the pull request | `JOB_STATUS`, `CONTEXT`, `HEAD_SHA`, `PULL_REQUEST`, `DESCRIPTION`, `ATTEMPTS`, `GH_TOKEN` |
| `held-runs` | deletes the pull request runs GitHub holds for approval on a branch's tip | `BRANCH`, `GH_TOKEN` |
| `playwright` | installs the browsers `BROWSERS` names with `install`, or their system packages with `install-deps` | `BROWSERS` |
| `preview-address` | reads the preview address of the branch | the Cloudflare credentials |
| `preview-deploy` | deploys the preview | the Cloudflare credentials, `ORIGIN` |
| `preview-comment` | posts the preview link on the pull request | `ORIGIN`, `HEAD_SHA`, `GH_TOKEN` |
| `preview-remove` | deletes the branch's deployments and says so on the pull request | the Cloudflare credentials, `GH_TOKEN` |
| `pages-deploy` | deploys the built pages | the Cloudflare credentials |
| `pages-served` | waits until the origin serves every built file as built | `ORIGIN`, `DIRECTORY`, `ATTEMPTS` |
| `pages-staged-commit` | reads the commit the Pages project serves | the Cloudflare credentials |
| `pages-publish` | pushes the build to the production repository | `DEPLOY_KEY`, `REPOSITORY`, `SOURCE_SHA` |
| `lighthouse` | audits each page and writes the median scores to the job summary | `ORIGIN`, `LIGHTHOUSE` |

`lighthouse` installs the Lighthouse the kit pins unless `LIGHTHOUSE` names one.

## What it reads

It reads the command from its first argument and the inputs from the environment.
The commands that call GitHub read `GITHUB_REPOSITORY` and `GH_TOKEN`.

## Arguments

```sh
checks-ci <command>
checks-ci playwright install
```

## Exit codes

| Code | When |
| --- | --- |
| 0 | the step passed |
| 1 | the step failed, and the failure prints as an `::error::` annotation |
| 2 | the command is not one `checks-ci` takes |

## Sample output

```
changes: 4 changed file(s), docs-only=false, tests-only=false
```

## When it runs

The workflows and the two actions `checks-workflows --write --full` writes call `bunx checks-ci <command>` in their steps.

## Related topics

- [checks-workflows](checks-workflows.md)
