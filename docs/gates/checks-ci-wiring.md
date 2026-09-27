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

## What it reads

The bin reads `.github/workflows/*.yml`, `*.yaml` and the `scripts` in `package.json` from the working tree.
It reads the target branch from `GITHUB_BASE_REF`, then from `refs/remotes/origin/HEAD` and then from the event file `GITHUB_EVENT_PATH` names.
It parses the workflows with `Bun.YAML` without executing them.

## Arguments

It takes no arguments.

## Exit codes

| Code | Result |
| --- | --- |
| 0 | Every required command has a reachable step. |
| 1 | A required command is missing or blocked. |
| 2 | A workflow or `package.json` cannot be decoded. |

## Sample output

A missing step produces a report like this:

```
ci-wiring: 1 of 6 gate(s) do not run on pull requests to main:
  bun run test
    no run step invokes it
```

## When it runs

`checks-lint` runs it in every repository.

## Related topics

- [checks-lint](checks-lint.md)
- [Native settings](../configs/native-settings.md)
