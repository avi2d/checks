---
kind: reference
audience: consumers
---
# checks-ci-wiring

`checks-ci-wiring` verifies that required commands run in the repository's own pull request workflows.

## What it checks

The kit requires `./node_modules/.bin/commitlint` on every pull request.
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

### Runners

It also judges the runner of every job in every workflow.
A mutation job is one with a run step that calls `stryker run`, `checks-mutation`, `checks-mutation-compare`, a `package.json` script that does, or a shell script in the repository that does, directly or through `bun`, `bun run` or `bunx`.
A command runs a shell script by a path inside the repository, such as `scripts/mutate.sh` or `./mutate.sh`, or as a `bun` target that no `package.json` script names.
The path resolves from the directory the command runs in: the step's `working-directory`, the job's or the workflow's `defaults.run.working-directory`, `bun --cwd=` and a literal `cd`.
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
| 1 | A required command is missing or blocked, or a job runs on the wrong runner. |
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

## When it runs

`checks-lint` runs it in every repository.

## Related topics

- [checks-lint](checks-lint.md)
- [Native settings](../configs/native-settings.md)
