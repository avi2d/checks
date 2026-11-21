---
kind: reference
audience: consumers
---
# checks-no-mistakes-test

`checks-no-mistakes-test` is the gate that keeps repository tests out of the no-mistakes test step.

## What it checks

It fails when `.no-mistakes.yaml` sets `commands.test` to any value, so the test step runs no repository test on the machine that runs the pipeline.
CI on the pull request runs the tests instead.
It fails on a command that runs only the changed tests, such as `checks-test --changed`, as well as on one that runs the whole suite.
It fails on an empty or null `commands.test` too, so the key itself must go.
It passes when `commands.test` is absent.
Without `commands.test`, the no-mistakes test step runs no baseline command and keeps only its evidence agent.

## What it reads

It reads the working tree.
It reads `commands.test` from `.no-mistakes.yaml`.

## Arguments

```sh
checks-no-mistakes-test [<directory>]
```

It checks the directory it runs in, or the directory it is given.

## Exit codes

| Code | When |
| --- | --- |
| 0 | `commands.test` is absent |
| 1 | `commands.test` is present |
| 2 | `.no-mistakes.yaml` does not parse |

## Sample output

```
no-mistakes-test: 1 violation(s)
  .no-mistakes.yaml: commands.test must stay absent, since the pipeline runs no repository tests on the machine it runs on and CI runs them, found "bun run test:fast"
```

## When it runs

`checks-lint` runs it in the full run when the repository tracks `.no-mistakes.yaml`.

## Related topics

- [checks-test](checks-test.md)
- [checks-lint](checks-lint.md)
