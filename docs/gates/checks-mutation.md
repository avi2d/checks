---
kind: reference
audience: consumers
---
# checks-mutation

`checks-mutation` runs Stryker and refuses a full run outside CI.

## What it checks

It refuses a full mutation run when `CI` is not `true`.
A full run is one with no `--mutate <glob>` and no `--incremental` flag.
A `--mutate` without a glob, `--incrementalFile` alone or `--incremental` with `--force` is still a full run.
Its refusal names `gh workflow run mutation` as the command that starts the same run in CI.
A run scoped with `--mutate <glob>` or `--mutate=<glob>` stays allowed locally, because pull request comparisons scope to named files.
An incremental run stays allowed locally, because it reuses the results of mutants that did not change.
`--help`, `-h` and `--version` are not runs, so they pass straight through to Stryker.
A laptop with `CI=true` set opts in to a full run on purpose, and the refusal lets it through.

The shared Stryker preset makes the same decision from `process.argv` when a `stryker run` loads it.
So a bare `bunx stryker run` in a repository whose `stryker.conf.mjs` spreads the preset is refused the same way, and `checks-mutation` is a thin wrapper over that decision.

## What it reads

It reads `CI` from the environment.
It forwards every argument to `stryker run` through `bun x stryker run`.

## Arguments

```sh
checks-mutation [--mutate <glob>] [--incremental] [<stryker args>...]
```

Every argument after the bin name forwards to `stryker run`.

## Exit codes

| Code | When |
| --- | --- |
| 0 | Stryker exited 0 |
| 1 | Stryker exited nonzero |
| 2 | a full run outside CI was refused, or Stryker could not start |

## Sample output

A full run outside CI prints its refusal and exits 2:

```
checks-mutation: refusing a full mutation run outside CI; start the same run in CI with `gh workflow run mutation`, or scope this run with `--mutate <glob>` or `--incremental`
```

A bare `bunx stryker run` fails to load its config with the same refusal as the error and exits 1.

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
    runs-on: ${{ vars.CI_RUNS_ON || fromJSON('["self-hosted","Linux","X64","winbox"]') }}
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

With `CI_RUNS_ON` unset, the job runs on the fleet's self-hosted Linux runner labelled `winbox`, which is where a private repository sends its full sweeps.
A repository sets `CI_RUNS_ON` only to name a different runner.
GitHub sets `CI=true` on every runner, so the preset lets the full run through there.

## Related topics

- [checks-mutation-compare](checks-mutation-compare.md)
- [checks-subsumed-tests](checks-subsumed-tests.md)
