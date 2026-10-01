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
A run scoped with `--mutate <glob>`, `--mutate=<glob>` or `-m <glob>` stays allowed locally, because pull request comparisons scope to named files.
An incremental run stays allowed locally only when its incremental report exists, because it reuses the results of mutants that did not change.
That report is the `incrementalFile` Stryker resolves from the command line and the config file, else `reports/stryker-incremental.json`.
With no report there, the refusal says to pass `--mutate <glob>`, or to start the full baseline in CI with `gh workflow run mutation`.
`--help`, `-h` and `--version` are not runs, so they pass straight through to Stryker.
A laptop with `CI=true` set opts in to a full run on purpose, and the refusal lets it through.

The shared Stryker preset makes the same decision from `process.argv` when a `stryker run` loads it.
So a bare `bunx stryker run` in a repository whose `stryker.conf.mjs` spreads the preset is refused the same way, and `checks-mutation` is a thin wrapper over that decision.
The preset also registers an ignore plugin that checks the incremental report once Stryker has resolved its options, because a config file can set `incrementalFile` after the preset loads.
A config that replaces `plugins` or `ignorers` must keep the preset's entries, or that check does not run.

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
| 1 | Stryker exited nonzero, including an incremental run refused for a missing report |
| 2 | a full run outside CI was refused, or Stryker could not start |

## Sample output

A full run outside CI prints its refusal and exits 2:

```
checks-mutation: refusing a full mutation run outside CI; start the same run in CI with `gh workflow run mutation`, or scope this run with `--mutate <glob>` or `--incremental`
```

A bare `bunx stryker run` fails to load its config with the same refusal as the error and exits 1.
An `--incremental` run with no report stops before instrumenting with the missing-report refusal as the error and exits 1.

## When it runs

A repository runs full baselines from the mutation workflow on `workflow_dispatch`.
A repository that picks a pull request scope from a baseline also runs that workflow on a nightly schedule.
The scope step reads the latest successful scheduled or hand-started run on `main` for its full perTest coverage.
Run scoped checks locally during development.
A scheduled run costs a full Stryker run.

## Running it in CI

A repository starts a baseline by hand from a workflow named `mutation` and keeps its report as an artifact:

```yaml
name: mutation
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
The `name: mutation` line is what `gh workflow run mutation` looks up.
GitHub sets `CI=true` on every runner, so the preset lets the full run through there.

## Related topics

- [checks-mutation-compare](checks-mutation-compare.md)
- [checks-subsumed-tests](checks-subsumed-tests.md)
