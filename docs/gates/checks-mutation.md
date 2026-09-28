---
kind: reference
audience: consumers
---
# checks-mutation

`checks-mutation` runs Stryker and refuses a full run outside CI.

## What it checks

It refuses a full mutation run when `CI` is not true.
A full run is one with no `--mutate` flag and no `--incremental` flag.
Its refusal names `gh workflow run mutation` as the command that starts the same run in CI.
A run scoped with `--mutate` stays allowed locally, because pull request comparisons scope to named files.
An incremental run stays allowed locally, because a worker rechecks only changed mutants.
A full sweep runs in CI and never on a laptop.

## What it reads

It reads `CI` from the environment.
It forwards every other argument to `stryker run` through `bun x stryker run`.

## Arguments

```sh
checks-mutation [--mutate <glob>...] [--incremental] [<stryker args>...]
```

Every argument after the bin name forwards to `stryker run`.
`--help` prints the usage without running Stryker.

## Exit codes

| Code | When |
| --- | --- |
| 0 | Stryker passed, or `--help` was given |
| 1 | Stryker exited nonzero |
| 2 | a full run outside CI was refused, or Stryker could not start |

## Sample output

A full run outside CI prints its refusal and exits 2:

```
checks-mutation: refusing a full mutation run outside CI; start the same run in CI with `gh workflow run mutation`, or scope this run with `--mutate` or `--incremental`
```

## When it runs

A repository runs full baselines from the mutation workflow on `workflow_dispatch`.
Run scoped checks locally during development.
A scheduled run never starts one, because a baseline costs a full Stryker run.

## Running it in CI

A repository starts a baseline by hand and keeps its report as an artifact:

```yaml
on:
  workflow_dispatch:
jobs:
  mutation:
    runs-on: ${{ vars.CI_RUNS_ON || 'ubuntu-latest' }}
    steps:
      - uses: actions/checkout@v5
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version-file: .bun-version
      - run: bun install --frozen-lockfile
      - run: bunx stryker run
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: mutation-report
          path: reports/mutation/mutation.json
```

Private repositories set the `CI_RUNS_ON` variable to their self-hosted runner label.
The kit leaves the variable unset and falls back to `ubuntu-latest` at no cost.

## Related topics

- [checks-mutation-compare](checks-mutation-compare.md)
