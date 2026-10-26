---
kind: reference
audience: consumers
---
# checks-night-run

`checks-night-run` turns a night run on `main` into GitHub issues, one for each file whose mutation score fell and one for each failing test.

## What it checks

It scores each file of tonight's Stryker report as Stryker does, the `Killed` and `Timeout` mutants over every mutant but the `Ignored`, `CompileError`, `RuntimeError` and `Pending` ones.
It compares each file's score with the same file's score from the previous night.
A file whose score is lower than the previous night's is a finding.
A file only one night holds is no finding, since it lacks one of the two scores.
A file with no scored mutant has no score, so it is no finding either.
An equal score is no finding, even when it counts other mutants.
Each failing test in a JUnit report is a finding, whatever the previous night holds.
A file whose test worker crashed is one finding, since Bun reports none of its tests.
With no previous night it compares no score and still files each failing test.
With no mutation report it compares and records no score and still files each failing test.

Each finding has a key that stays the same from night to night:

| Finding | Key |
| --- | --- |
| a file whose mutation score fell | `mutation:<file>` |
| a failing test | `test:<file> > <describe> > <name>` |
| a file whose test worker crashed | `test:<file>` |

## How it files a finding

It creates the `night-run` label when the repository lacks it.
It reads every open issue labelled `night-run`, and reads the key each one carries in a hidden marker in its body.
A finding whose key an open issue carries gets one comment on that issue, so a regression that lasts two nights stays one issue.
Any other finding opens one issue labelled `night-run`.
The issue and the comment name tonight's run, the file and either the test or the score of both nights.
The body holds the file, the full test name and the finding key.
A title longer than GitHub's 256 characters is cut to at most 256 and ends in `…`.
A night with no finding makes no call to GitHub's issues or labels at all.
Closing an issue ends it, and the same finding on a later night opens a new one.
Agents and people fix each issue as a task of its own, so no pull request waits for a night run.
A run on any ref but `refs/heads/main` files no issue and records no score, and lists each finding in its log only.

## What it reads

It reads tonight's Stryker `mutation.json` report, when the mutation run left one, and any number of JUnit reports, such as the ones `checks-test --junit=<file>` keeps, as [checks-test](checks-test.md#arguments) says.
It scans the newest 30 successful runs of the same workflow on `main` from newest to oldest.
It takes the first run whose `night-run` artifact still exists as the previous night.
That artifact holds `night-run.json`, the scores the run recorded.
When no scanned run holds the artifact it compares no score.
A run on another branch never becomes the previous night.
On `main` with a mutation report it writes tonight's scores to `reports/night-run.json`, and the workflow uploads that file as the `night-run` artifact.
It reads the run from `GITHUB_SERVER_URL`, `GITHUB_REPOSITORY`, `GITHUB_RUN_ID`, `GITHUB_WORKFLOW_REF` and `GITHUB_REF`, so it runs only inside a GitHub Actions job.
It calls `gh` with the job's `GH_TOKEN`, which needs `actions: read` for the previous night and `issues: write` for the issues.

## Arguments

```sh
checks-night-run [--mutation <mutation-report>] [--tests <junit-report>]...
```

`--mutation` names tonight's Stryker report and is given at most once.
`--tests` names one JUnit report and is given once per report.
At least one report is given.

## Exit codes

| Code | When |
| --- | --- |
| 0 | it filed every finding and recorded tonight's scores, it found nothing to file, or the run is off `main` and it listed each finding |
| 2 | an argument does not parse, a report does not decode, a GitHub Actions variable is unset or a `gh` call fails |

It never exits 1, because a finding becomes an issue rather than a failed run.

## Sample output

```
checks-night-run: the night run https://github.com/acme/widget/actions/runs/12 compared with the night run https://github.com/acme/widget/actions/runs/11; 2 finding(s)
  opened #31 for mutation:src/cart.ts
  commented on #27 for test:tests/unit/cart.test.ts > totals > rounds half to even
checks-night-run: recorded 42 file score(s) in reports/night-run.json
```

## When it runs

Only a night workflow the repository writes runs it, after that workflow's full mutation run and its long test tiers.

## Running it at night

A repository runs it from a workflow named `night-run` on a schedule, and starts the same workflow by hand with `gh workflow run night-run`:

```yaml
name: night-run
on:
  schedule:
    - cron: "7 22 * * *"
  workflow_dispatch:
permissions:
  contents: read
concurrency:
  group: night-run
  cancel-in-progress: false
jobs:
  mutation:
    runs-on: ubuntu-latest
    timeout-minutes: 60
    steps:
      - uses: actions/checkout@v5
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version-file: .bun-version
      - run: bun install --frozen-lockfile
      - run: bunx stryker run
      - uses: actions/upload-artifact@v4
        with:
          name: night-run-mutation
          path: reports/mutation/mutation.json
          retention-days: 1
  tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version-file: .bun-version
      - run: bun install --frozen-lockfile
      - run: |
          bunx checks-test --tier=live --junit=reports/night-run-tests/live.xml || true
          bunx checks-test --tier=pixel --junit=reports/night-run-tests/pixel.xml || true
      - uses: actions/upload-artifact@v4
        with:
          name: night-run-tests
          path: reports/night-run-tests/
          retention-days: 1
  report:
    needs: [mutation, tests]
    if: ${{ !cancelled() && needs.tests.result == 'success' }}
    runs-on: ubuntu-latest
    permissions:
      contents: read
      actions: read
      issues: write
    steps:
      - uses: actions/checkout@v5
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version-file: .bun-version
      - run: bun install --frozen-lockfile
      - if: needs.mutation.result == 'success'
        uses: actions/download-artifact@v4
        with:
          name: night-run-mutation
          path: reports/mutation
      - uses: actions/download-artifact@v4
        with:
          name: night-run-tests
          path: reports/night-run-tests
      - env:
          GH_TOKEN: ${{ github.token }}
        run: bunx checks-night-run ${{ needs.mutation.result == 'success' && '--mutation reports/mutation/mutation.json' || '' }} --tests reports/night-run-tests/live.xml --tests reports/night-run-tests/pixel.xml
      - uses: actions/upload-artifact@v4
        with:
          name: night-run
          path: reports/night-run.json
          if-no-files-found: ignore
          retention-days: 90
```

The cron starts the run at 22:07 UTC, inside the kit's own night window from 22:00 to 22:30 UTC.
A repository takes minute 7 of its own tier's 30 minute night window, so repositories do not start together.
The tests job runs each long tier the repository holds, `live` and `pixel` as [checks-test](checks-test.md#test-tiers) names them, and keeps each JUnit report.
Each `|| true` lets the job go on to the upload after a failing test, since that test becomes an issue.
A tier that writes no report fails the report job, because `checks-night-run` cannot read it.
The report job runs whenever the tests job succeeds, so a failing test that also stops Stryker still becomes an issue.
It passes `--mutation` only when the mutation job succeeded, and the failed mutation job still fails the run.
The concurrency group queues a run started by hand behind the scheduled one, so two runs never file the same finding twice.
A dispatch on a branch runs both jobs and lists its findings in the report job's log, and `if-no-files-found: ignore` lets that run upload no record.
`issues: write` on the report job is the one permission beyond reading the repository and its runs.
A public repository keeps `runs-on: ubuntu-latest` on every job.
A private repository sets `runs-on` on the mutation job to the labels declared under `checks.mutationRunner` in `package.json`, and [checks-ci-wiring](checks-ci-wiring.md#runners) refuses a mutation job that names `CI_RUNS_ON`.
A private repository sets `runs-on: ${{ vars.CI_RUNS_ON || 'ubuntu-latest' }}` on the tests and report jobs.
A successful run uploads `night-run`, so the next night compares with it, and a failed run uploads nothing a later night reads.
The artifact keeps 90 days, so a gap of nights still leaves a previous night to compare with.

## Related topics

- [checks-test](checks-test.md)
- [checks-mutation](checks-mutation.md)
- [checks-mutation-compare](checks-mutation-compare.md)
- [checks-ci-wiring](checks-ci-wiring.md)
