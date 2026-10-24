---
kind: reference
audience: consumers
---
# checks-ci-wiring

`checks-ci-wiring` verifies that required commands run in the repository's own pull request workflows.

## What it checks

The kit requires `bunx checks-commit-title` on every pull request.
A step that calls `bun src/delivery/commit-title.ts` or `./node_modules/.bin/commitlint` directly still satisfies the check.
It requires `bun run lint`, `bun run build`, `bun run typecheck` and `bun run test` for each of those scripts that `package.json` defines.
When `package.json` defines both `test:unit` and `test:e2e`, a step for each of `bun run test:unit` and `bun run test:e2e` also satisfies `bun run test`.
A `build` script also requires `git diff --exit-code`.
The target branch is the pull request base in CI, else the branch `refs/remotes/origin/HEAD` names, else the default branch of the repository in GitHub's event, else `main`.
A `pull_request` trigger without a branch filter covers every target branch.

Each command needs its own plain `run` step.
A step can call a path command through `bun run`.
The check follows local reusable workflows but not remote reusable workflows.
It refuses a step or job with `if: false` or `continue-on-error: true`.
It also refuses a workflow that does not trigger on both `opened` and `synchronize` pull requests to the target branch.
A path filter cannot cover every pull request and therefore cannot satisfy the check.
It refuses a reference to a workflow or job the repository does not hold.
Each literal `checks-release-pr` and `checks-release-tag` argument names a workflow file, so every one must match a file under `.github/workflows/`.
A call counts directly, through `bunx`, or through `bun` or `bun run` with the bin's path or its source file.
An argument built from a variable or an expression is known only when the job runs, so the check passes over it.
An argument built by command substitution is known only when the job runs, so the check passes over it.
Each `on.workflow_run.workflows` entry names a workflow by its `name`, so every one must match a name in the repository.
A workflow without a `name` answers to its path from the repository root.
A local reusable `uses` must name a file under `.github/workflows/` that the repository holds.
Each `needs` entry names a job in the same workflow, so every one must match a job id in that file.
Each refusal names the file, the line and the missing workflow or job.

### Runners

It also judges the runner of every job in every workflow.
A mutation job is one with a run step that calls `stryker run`, `checks-mutation` or `checks-mutation-compare`, directly or through `bun`, `bun run` or `bunx`.
The call counts too through a `package.json` script or a shell script in the repository.
A command runs a shell script by a path inside the repository, such as `tools/mutate.sh` or `./mutate.sh`, or as a `bun` target that no `package.json` script names.
The path resolves from the directory the command runs in: the step's `working-directory`, the job's or the workflow's `defaults.run.working-directory`, `bun --cwd` and a literal `cd`.
A script file runs in its caller's directory, and a `package.json` script runs from the repository root.
A path the check cannot know before the run, such as one built from an expression or a variable, reaches no file.
A file counts as a shell script when its name ends in `.sh` or its first line names `sh`, `bash`, `dash`, `ksh` or `zsh`.
The call counts as a command of its own or inside a command substitution, never as an argument to another command.
A here-document that `sh`, `bash`, `dash`, `ksh` or `zsh` reads is a script, and its calls count.
The text of any other here-document is data, so a call there counts only inside a command substitution when the delimiter is unquoted.
A mutation job never names `CI_RUNS_ON` directly in `runs-on`, as `vars.CI_RUNS_ON` or `vars['CI_RUNS_ON']`, so an override for an outage cannot send its mutation runs to hosted runners.
Any other job that names `CI_RUNS_ON` in `runs-on` carries exactly the hosted-default expression `${{ vars.CI_RUNS_ON || 'ubuntu-latest' }}`.
A public repository carries no self-hosted runner on a job a fork can reach, because a pull request from a fork would run its own code on that runner.
A fork reaches a job through `pull_request`, `pull_request_target`, `pull_request_review`, `pull_request_review_comment` or `issue_comment`, directly, through a local reusable workflow a reached job calls, or through a `workflow_run` trigger that names a reached workflow.
Such a job refuses a literal `self-hosted` label, a label that interpolates an expression, a label in a set declared under `checks.mutationRunner` or `checks.selfHostedRunners`, a runner `group` and any other expression than the hosted-default expression.
A `runs-on` that is exactly `${{ matrix.<key> }}` judges each matrix value as its own labels.
It refuses a value that names `self-hosted` or falls inside a label set declared under `checks.mutationRunner` or `checks.selfHostedRunners`.
Any other expression refuses as unresolvable.
A job on `push` or another trigger no fork reaches may still name self-hosted labels.
In a private repository each mutation job carries exactly the labels the consumer declares in `package.json` under `checks.mutationRunner`.
Every other job there carries exactly the hosted-default expression, or exactly one of the label sets the consumer declares under `checks.selfHostedRunners`.
A repository without those declarations fails each job they would pin until it declares them.
The check knows a repository is private only from GitHub's event, so a run outside CI judges only the rules that hold in either.

### Bun version

It also judges every step that uses `oven-sh/setup-bun`.
A step at ref `v2`, `v2.<minor>` or `v2.<minor>.<patch>` resolves its effective version in the order setup-bun v2 reads it.
A step at any other ref or at none fails, because the check knows only setup-bun v2's version resolution.
An input name matches in any case, as GitHub reads it.
The step input `with.bun-version` wins when it names a version, and an unquoted number counts as the text GitHub passes.
Else the file the step input `with.bun-version-file` names decides by its basename, when it yields a version.
A `package.json` file reads `packageManager` after `bun@`, and reads `engines.bun` only when `packageManager` is absent or holds no `bun@`.
A `.tool-versions` file reads the rest of the first line that starts with `bun`.
A `.bun-version` or `.bumrc` file reads the whole trimmed file.
Else the `package.json` at the workspace root reads the same way.
Else setup-bun installs latest.
A blank version counts as none.
A repository passes by writing the fleet version to `.bun-version` and naming that file in each step's `with.bun-version-file`.
The fleet version is the version the kit ships in its own `.bun-version`.
The step fails the check when the version is missing or differs from the fleet bun version.
A range fails because it differs from the fleet version.
A version built from an expression fails because it cannot be shown equal before the run.
This rule skips a repository with no setup-bun step.
A kit release that moves the fleet version turns each consumer red until its pin follows.
Each refusal names the workflow file and line, the version found and where it was read, and the fleet version.

## What it reads

The bin reads `.github/workflows/*.yml`, `*.yaml`, the `scripts` and `checks` runners in `package.json` and the shell scripts those steps and scripts run from the working tree.
It reads each file a setup-bun step names for its version.
It reads the fleet pin from the kit's own `.bun-version`.
It reads the target branch from `GITHUB_BASE_REF`, then from `refs/remotes/origin/HEAD` and then from the event file `GITHUB_EVENT_PATH` names.
It reads whether the repository is private from `repository.private` in that event file.
It parses the workflows with `Bun.YAML` without executing them.

## Arguments

It takes no arguments.

## Exit codes

| Code | Result |
| --- | --- |
| 0 | Every required command has a reachable step. |
| 1 | A required command is missing or blocked, a job runs on the wrong runner, a workflow names a missing workflow or job, or a setup-bun step drifts from the fleet bun version. |
| 2 | A workflow or `package.json` cannot be decoded, or the kit's own `.bun-version` is missing, unreadable or blank. |

## Sample output

A missing step produces a report like this:

```
ci-wiring: 1 of 6 gate(s) do not run on pull requests to main:
  bun run test
    no run step invokes it
```

A mutation job that names `CI_RUNS_ON` in `runs-on` produces a report like this:

```
ci-wiring: 1 job(s) run on the wrong runner:
  .github/workflows/mutation-compare.yml job mutation-compare: a mutation job reads CI_RUNS_ON, so an override moves its mutation runs off [self-hosted, gpu, x64]; set runs-on: [self-hosted, gpu, x64]
```

A reference to a missing workflow produces a report like this:

```
ci-wiring: 1 reference(s) name a missing workflow or job:
  .github/workflows/daily-release.yml line 31: names missing workflow commitlint.yml
```

## When it runs

`checks-lint` runs it in every repository.

## Related topics

- [checks-lint](checks-lint.md)
- [Native settings](../configs/native-settings.md)
