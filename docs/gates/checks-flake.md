---
kind: reference
audience: consumers
---
# checks-flake

`checks-flake` is the scheduled run that finds flaky tests and records the seeds each one fails with.

## What it checks

A green run proves nothing failed in that run, not that no test is flaky.
`checks-flake` runs the whole suite several times, each with its own `--seed`, and records per failing test the seeds it failed with.
`bun test --randomize --seed=<seed>` puts the suite in the same order, so a seed reproduces a failure that hangs on order.
A run that fails with no failing test, such as a test file that throws while loading, is listed with its seed on its own line.

## Parallel hunts

A repository whose `test` script passes `--parallel=<workers>` to [checks-test](checks-test.md#parallel-runs) is hunted with the same worker count, so each run is `bun test --randomize --seed=<seed> --parallel=<workers>`, the mode CI runs in.
A `test` script without the option keeps the serial hunt.

Under workers a seed fixes the order Bun hands out the files.
Which worker takes each file is a race between the workers.
Rerunning a failing seed with the same worker count therefore reproduces the failure only some of the time.
A failure that hangs on which files share a worker comes back every time from that worker's files.
They run again in one process, in the order the worker ran them.

So `checks-flake` passes Bun a preload that records which worker ran each file, after the repository's own `[test]` preload in `bunfig.toml`.
For each failing worker in a failed run, the summary prints a replay command.
It runs the files that worker ran, up to the last failing one:

```sh
bun test --isolate ./tests/unit/session.test.ts ./tests/unit/cache.test.ts
```

`--isolate` gives each file a fresh global in one process, as a worker does.
The replay leaves out `--randomize`, because Bun would shuffle the files it lists.
It therefore runs each file's tests in source order.
A failure that also hangs on the order of tests inside a file reproduces only with the seed.
The summary still names the seed and the worker count, and says that rerunning them reproduces only some of the time.
A run whose worker crashed gets a replay of that worker's files up to the crashed one.

## What it reads

It reads bun's JUnit report of each run.
It reads the worker count from the `test` script in `package.json`, as [checks-test-layout](checks-test-layout.md) validates that script, and hunts serially when the file is missing.
Under workers it reads the record its preload writes of which worker ran each file.
Under GitHub Actions it appends its summary to the file `GITHUB_STEP_SUMMARY` names, which is the job summary.

## Arguments

```sh
checks-flake [--runs <count> | --seed <seed>...] [--report <file>]
```

`--runs` sets the number of runs on random seeds, 10 when absent.
`--seed`, given once per run, replays chosen seeds, such as the ones a report recorded.
`--report` writes the record as JSON, holding every run's seed and failing tests and every failing test's seeds.
Under workers the record also holds `parallel`, the worker count and each replay's seed and files.

## Exit codes

| Code | When |
| --- | --- |
| 0 | every run passed |
| 1 | a run failed |
| 2 | an argument does not parse, `package.json` does not decode, or bun passed without writing its report |

## Sample output

```
checks-flake: 3 of 10 run(s) failed, 1 test(s) failing in them

| Test | Failed | Seeds |
| --- | --- | --- |
| tests/unit/cache.test.ts:6 reads the cache | 3 of 10 runs | 2170533150, 4046124386, 180394251 |

Reproduce a failing run with bun test --randomize --seed=<seed>.
```

A hunt on workers prints a replay for each failed run:

```
checks-flake: 2 of 10 run(s) failed on 4 worker(s), 1 test(s) failing in them

| Test | Failed | Seeds |
| --- | --- | --- |
| tests/unit/cache.test.ts:6 reads the cache | 2 of 10 runs | 2170533150, 180394251 |

Reproduce a failing run with the files its failing worker ran, in that order:

- seed 2170533150: `bun test --isolate ./tests/unit/session.test.ts ./tests/unit/cache.test.ts`
- seed 180394251: `bun test --isolate ./tests/unit/pricing.test.ts ./tests/unit/session.test.ts ./tests/unit/cache.test.ts`

Rerunning a seed with bun test --randomize --seed=<seed> --parallel=4 reproduces a failing run only some of the time, because which worker takes each file is a race.
```

## When it runs

Only a schedule the repository writes runs it.

## Running it on a schedule

A repository runs it on a schedule and keeps the record of a failed run as an artifact:

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
        with:
          bun-version-file: .bun-version
      - run: bun install --frozen-lockfile
      - run: bunx checks-flake --runs 10 --report flake-report.json
      - uses: actions/upload-artifact@v4
        if: failure()
        with:
          name: flake-report
          path: flake-report.json
          retention-days: 7
```

A passing run's job summary holds all its seeds, so a passing run uploads nothing.
In a private repository every upload counts against the account's Actions storage, and GitHub refuses each one once that storage is used up.
A run that only uploads on failure stays green through that refusal, and a failing run is red for its tests either way.

A private repository sets `runs-on: ${{ vars.CI_RUNS_ON || 'ubuntu-latest' }}` on the job, as [checks-ci-wiring](checks-ci-wiring.md#runners) requires.

## Related topics

- [checks-test](checks-test.md)
- [checks-test-layout](checks-test-layout.md)
- [checks-ci-wiring](checks-ci-wiring.md)
