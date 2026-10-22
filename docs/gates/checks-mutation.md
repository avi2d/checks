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
A run scoped with `--mutate <glob>`, `--mutate=<glob>` or `-m <glob>` stays allowed locally, because a branch comparison scopes to named files.
An incremental run stays allowed locally only when its incremental report exists, because it reuses the results of mutants that did not change.
That report is the `incrementalFile` Stryker resolves from the command line and the config file, else `reports/stryker-incremental.json`.
With no report there, the refusal says to pass `--mutate <glob>`, or to start the full baseline in CI with `gh workflow run mutation`.
`--help`, `-h` and `--version` are not runs, so they pass straight through to Stryker.
A laptop with `CI=true` set opts in to a full run on purpose, and the refusal lets it through.

The shared Stryker preset makes the same decision from `process.argv` when a `stryker run` loads it.
So a bare `bunx stryker run` in a repository whose `stryker.conf.mjs` spreads the preset is refused the same way, and `checks-mutation` is a thin wrapper over that decision.
The preset also registers an ignore plugin that checks the incremental report once Stryker has resolved its options, because a config file can set `incrementalFile` after the preset loads.
A config that replaces `plugins` or `ignorers` must keep the preset's entries, or that check does not run.
The preset also exports `unitTestFiles`, which lists every `.test.ts` and `.test.tsx` file under `tests/unit` at config load.
A repository sets `bun.testFiles` to its result, so a covered, non-static mutant loads only the test files that cover it.
A static mutant has no per-test coverage, so it still loads every listed file, and with bail it stops at the first test that fails.
So when a `stryker run` without `--ignoreStatic` loads the preset, the preset first runs the listed files once with `bun test` and times each file.
`unitTestFiles` then lists each file with a leading `./`, fastest first, and Bun runs such paths in the order given.
It then lists each path again without the `./`, the spelling the runner matches a covering test against.
Bun loads a file once however often the list names it.
When that timing run fails, the preset prints why on stderr and `unitTestFiles` keeps the path order.
The config then reads:

```js
import preset, { unitTestFiles } from "@avi2dg/checks/stryker.preset.js";

export default {
  ...preset,
  bun: {
    ...preset.bun,
    testFiles: unitTestFiles(),
  },
};
```

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
A repository that picks a branch scope from a baseline starts that workflow weekly with `gh workflow run mutation`, because a GitHub schedule can start hours late.
Run scoped checks locally during development.
A first baseline with no state costs a full Stryker run, and each later one retests only the mutants its changes touch.

## Running it in CI

A repository starts a baseline by hand from a workflow named `mutation` and keeps its report as an artifact:

```yaml
name: mutation
on:
  workflow_dispatch:
jobs:
  mutation:
    runs-on: [self-hosted, Linux, X64, winbox]
    steps:
      - uses: actions/checkout@v5
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version-file: .bun-version
      - run: bun install --frozen-lockfile
      - env:
          GH_TOKEN: ${{ github.token }}
        run: bunx checks-mutation-baseline --full reports/mutation/mutation.json reports/stryker-incremental.json
      - run: bunx stryker run --incremental
      - run: bunx checks-mutation-baseline --slim reports/mutation/mutation.json "$RUNNER_TEMP/full/mutation.json"
      - uses: actions/upload-artifact@v4
        with:
          name: mutation-baseline-full
          path: |
            ${{ runner.temp }}/full/mutation.json
            reports/stryker-incremental.json
          retention-days: 30
```

A run that restores no state tests every mutant, so its report names every test that covers each covered mutant and the first test that killed each killed mutant.
[checks-mutation-scope](checks-mutation-scope.md#what-it-reads) says why that one killer is enough.
The upload is the `mutation-baseline-full` artifact that a branch comparison's scope step restores with `checks-mutation-baseline --full`.
[checks-mutation-scope](checks-mutation-scope.md) reads it to bring in the sources a changed unit test covers or kills.
The restore reads only a successful run of `mutation.yml` on `main`, so a sweep that fails publishes nothing a scope step reads.
The artifact keeps 30 days, so the newest full baseline outlives the week between full runs.
The upload holds the report without each mutant's `statusReason`, as [checks-mutation-baseline](checks-mutation-baseline.md#the-saved-baselines) says, since the full report of a large repository passes 100 MB as an artifact.

The job runs on the fleet's self-hosted Linux runner labelled `winbox`, which is where a repository sends its full sweeps.
It never reads `CI_RUNS_ON`, so an override that moves a repository's other jobs during a runner outage leaves the sweep waiting for `winbox`.
[checks-ci-wiring](checks-ci-wiring.md#runners) refuses a mutation job that names it in `runs-on`.
The `name: mutation` line is what `gh workflow run mutation` looks up.
GitHub sets `CI=true` on every runner, so the preset lets the full run through there.

## Related topics

- [checks-mutation-compare](checks-mutation-compare.md)
- [checks-mutation-scope](checks-mutation-scope.md)
- [checks-subsumed-tests](checks-subsumed-tests.md)
