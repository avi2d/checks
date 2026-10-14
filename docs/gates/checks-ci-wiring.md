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
Each `checks-release-pr` argument names a workflow file, so every one must match a file under `.github/workflows/`.
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
A mutation job never names `CI_RUNS_ON` directly in `runs-on`, as `vars.CI_RUNS_ON` or `vars['CI_RUNS_ON']`, so an override for an outage cannot send its full sweeps to hosted runners.
Any other job that names `CI_RUNS_ON` in `runs-on` carries exactly the hosted-default expression `${{ vars.CI_RUNS_ON || 'ubuntu-latest' }}`.
In a private repository each mutation job carries exactly the labels `[self-hosted, Linux, X64, winbox]` and every other job exactly the hosted-default expression.
A public repository may keep `runs-on: ubuntu-latest` on every job, because a pull request from a fork runs its own code on the runner.
The check knows a repository is private only from GitHub's event, so a run outside CI judges only the rules that hold in either.

## What it reads

The bin reads `.github/workflows/*.yml`, `*.yaml`, the `scripts` in `package.json` and the shell scripts those steps and scripts run from the working tree.
It reads the target branch from `GITHUB_BASE_REF`, then from `refs/remotes/origin/HEAD` and then from the event file `GITHUB_EVENT_PATH` names.
It reads whether the repository is private from `repository.private` in that event file.
It parses the workflows with `Bun.YAML` without executing them.

## Arguments

It takes no arguments.

## Exit codes

| Code | Result |
| --- | --- |
| 0 | Every required command has a reachable step. |
| 1 | A required command is missing or blocked, a job runs on the wrong runner, or a workflow names a missing workflow or job. |
| 2 | A workflow or `package.json` cannot be decoded. |

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
  .github/workflows/mutation-compare.yml job mutation-compare: a mutation job reads CI_RUNS_ON, so an override moves its full sweeps off winbox; set runs-on: [self-hosted, Linux, X64, winbox]
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
