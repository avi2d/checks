# checks-flake

`checks-flake` is the scheduled run that finds flaky tests and records the seeds each one fails with, and a reader looks it up to reproduce a flaky failure.

## What it checks

A green run proves nothing failed in that run, not that no test is flaky.
`checks-flake` runs the whole suite several times, each with its own `--seed`, and records per failing test the seeds it failed with.
`bun test --randomize --seed=<seed>` puts the suite in the same order, so a seed reproduces a failure that hangs on order.
A run that fails with no failing test, such as a test file that throws while loading, is listed with its seed on its own line.

## What it reads

It reads bun's JUnit report of each run.
Under GitHub Actions it appends its summary to the file `GITHUB_STEP_SUMMARY` names, which is the job summary.

## Arguments

```sh
checks-flake [--runs <count> | --seed <seed>...] [--report <file>]
```

`--runs` sets the number of runs on random seeds, 10 when absent.
`--seed`, given once per run, replays chosen seeds, such as the ones a report recorded.
`--report` writes the record as JSON, holding every run's seed and failing tests and every failing test's seeds.

## Exit codes

| Code | When |
| --- | --- |
| 0 | every run passed |
| 1 | a run failed |
| 2 | an argument does not parse, or bun passed without writing its report |

## Sample output

```
checks-flake: 3 of 10 run(s) failed, 1 test(s) failing in them

| Test | Failed | Seeds |
| --- | --- | --- |
| tests/cache.test.ts:6 reads the cache | 3 of 10 runs | 2170533150, 4046124386, 180394251 |

Reproduce a failing run with bun test --randomize --seed=<seed>.
```

## Opting out

Nothing runs it but a schedule the repository writes.
A repository that stops scheduling it also drops it from `gates.scheduled`, which `checks-ci-wiring` otherwise fails on.

## Running it on a schedule

A repository runs it on a schedule and keeps the record as an artifact:

```yaml
on:
  schedule:
    - cron: "17 5 * * *"
  workflow_dispatch:
jobs:
  flake:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: oven-sh/setup-bun@v2
      - run: bun install --frozen-lockfile
      - run: bunx checks-flake --runs 10 --report flake-report.json
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: flake-report
          path: flake-report.json
```

It declares the step in `gates.scheduled`, so `checks-ci-wiring` fails once the schedule stops running it:

```json
"gates": {
  "ci": ["bun run lint", "bun run typecheck", "bun run test"],
  "scheduled": ["bunx checks-flake --runs 10 --report flake-report.json"]
}
```

## Related topics

- [checks-test](checks-test.md)
- [checks-ci-wiring](checks-ci-wiring.md)
