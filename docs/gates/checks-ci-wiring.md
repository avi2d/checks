# checks-ci-wiring

`checks-ci-wiring` verifies that required commands run in the repository's own pull request workflows.

## What it checks

The kit requires `bun run lint` and `./node_modules/.bin/commitlint` on every pull request.
A repository tracking TypeScript also runs `bun run build`, `git diff --exit-code`, `bun run typecheck` and `bun run test`.
The kit reads the default branch from `on.push.branches` in the workflows, with `main` as the fallback.

Each command needs its own plain `run` step.
A step can call a path command through `bun run`.
The check follows local reusable workflows but not remote reusable workflows.
It refuses a step or job with `if: false` or `continue-on-error: true`.
It also refuses a workflow that does not trigger on both `opened` and `synchronize` pull requests to the target branch.
A path filter cannot cover every pull request and therefore cannot satisfy the check.

## What it reads

The bin reads `.github/workflows/*.yml` and `*.yaml` from the working tree and checks whether git tracks TypeScript files.
It parses the workflows with `Bun.YAML` without executing them.

## Arguments

It takes no arguments.

## Exit codes

| Code | Result |
| --- | --- |
| 0 | Every required command has a reachable step. |
| 1 | A required command is missing or blocked. |
| 2 | A workflow cannot be decoded. |

## Sample output

A missing step produces a report like this:

```
ci-wiring: 1 of 6 gate(s) do not run on pull requests to main:
  bun run test
    no run step invokes it
```

## Opting out

Every repository runs this gate through `checks-lint`.

## Related topics

- [checks-lint](checks-lint.md)
- [Native settings](../configs/native-settings.md)
