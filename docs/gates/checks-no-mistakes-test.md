---
kind: reference
audience: consumers
---
# checks-no-mistakes-test

`checks-no-mistakes-test` is the gate that holds the no-mistakes test command to the tests the change reaches.

## What it checks

It fails when `commands.test` in `.no-mistakes.yaml` runs the whole suite instead of the tests the change reaches.
It passes when `commands.test` is absent.
It passes when `commands.test` runs `checks-test --changed` directly.
It passes when `commands.test` runs a `bun run` script whose definition runs `checks-test --changed`.
It fails on `bun run test` and on a bare `checks-test`, since each runs the whole suite.
It fails with exit 1 when the command contains a shell control character, so a chained `checks-test --changed && ...` line fails.
It fails with exit 1 when `--changed` is combined with `--full` or `--tier=`, since each combination refuses the run.
It fails with exit 1 when a `bun run` script name cannot resolve or when a chain of script names cycles.

## What it reads

It reads the working tree.
It reads `commands.test` from `.no-mistakes.yaml` and the script definitions from `package.json`.
It resolves a `bun run` script name to its definition, and follows a chain of such names until it reaches the test command.
A name it cannot resolve fails the run with exit 1, as does a chain of script names that cycles.

## Arguments

```sh
checks-no-mistakes-test [<directory>]
```

It checks the directory it runs in, or the directory it is given.

## Exit codes

| Code | When |
| --- | --- |
| 0 | `commands.test` is absent or runs only the tests the change reaches |
| 1 | `commands.test` runs the whole suite |
| 2 | `.no-mistakes.yaml` or `package.json` does not parse |

## Sample output

```
no-mistakes-test: 1 violation(s)
  .no-mistakes.yaml: commands.test must stay absent or run only the tests the change reaches as checks-test --changed, directly or through a bun run script that runs it, found "bun run test"
```

## When it runs

`checks-lint` runs it in the full run when the repository tracks `.no-mistakes.yaml`.

## Related topics

- [checks-test](checks-test.md)
- [checks-test-layout](checks-test-layout.md)
- [checks-lint](checks-lint.md)
