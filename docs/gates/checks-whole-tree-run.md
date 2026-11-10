---
kind: reference
audience: consumers
---
# checks-whole-tree-run

`checks-whole-tree-run` turns each finding of a whole-tree run on `main` into a GitHub issue.
A finding is a file whose mutation score fell, a failing test, a failed whole-tree gate or a missing mutation report.
It closes the issue of a test, gate or missing mutation report that a later run no longer reports, and it comments on a mutation issue it no longer reports without closing it, but only when a previous run exists and every requested mutation report is present.

## What it checks

It scores each file of this run's Stryker reports as Stryker does, the `Killed` and `Timeout` mutants over every mutant but the `Ignored`, `CompileError`, `RuntimeError` and `Pending` ones.
It compares each file's score with the same file's score from the previous run.
A file whose score is lower than the previous run's is a finding.
A file only one run holds is no finding, since it lacks one of the two scores.
A file with no scored mutant has no score, so it is no finding either.
An equal score is no finding, even when it counts other mutants.
Each failing test in a JUnit report is a finding, whatever the previous run holds.
Each whole-tree gate the lint log names as failed is a finding.
A log where every named gate is undecided files `checks-lint` itself, with no per-gate issue.
A log with no passing run and no named gate files `checks-lint` itself, so a gate run that never finished still reaches an issue.
A file whose test worker crashed is one finding, since Bun reports none of its tests.
With no previous run it compares no score and still files each failing test.
Each mutation report `--mutation` names that does not exist is a finding, since the mutation job that writes it failed, timed out or was cancelled.
With no mutation report it compares and records no score and still files each failing test.
With some mutation reports missing it compares the files the others hold and records no score.
The next run then compares every file with the last run that scored them all.

Each finding has a key that stays the same from run to run:

| Finding | Key |
| --- | --- |
| a file whose mutation score fell | `mutation:<file>` |
| a failing test | `test:<file> > <describe> > <name>` |
| a file whose test worker crashed | `test:<file>` |
| a whole-tree gate that failed | `gates:<gate>` |
| a missing mutation report | `mutation-report:<path>` |

## How it files a finding

It creates the `whole-tree-run` label when the repository lacks it.
It reads every open issue labelled `whole-tree-run`, and reads the key each one carries in a hidden marker in its body.
A finding whose key an open issue carries gets one comment on that issue, so a regression that lasts two runs stays one issue.
Any other finding opens one issue labelled `whole-tree-run`.
The issue and the comment name this run, the file and the test, the score of both runs or the failed gate.
The body holds the file, the full test name or the failed gate, and the finding key.
A title longer than GitHub's 256 characters is cut to at most 256 and ends in `…`.
A run with no finding creates no label and writes no issue, and only reads the open issues to close any test, gate or mutation-report issue whose finding is gone and, when a previous run exists and every requested mutation report is present, to comment on any mutation issue whose finding is gone.
Closing an issue ends it, and the same finding on a later run opens a new one.

## How it closes an issue

An open test, gate or mutation-report issue whose key this run's findings lack gets one comment naming this run and the key.
It then closes as completed.
When a previous run exists and every requested mutation report is present, an open mutation issue whose key this run's findings lack gets one comment that names this run and the key, and stays open.
A closed issue is no longer read, so a later run without the finding comments on it no more.
A comment that reports the finding carries a reported marker, and a note that a mutation finding is gone carries a noted marker.
A mutation issue whose latest marked comment already notes the finding gone gets no further note.
So a mutation finding gone for many runs is noted once, and noted again only after a later run reports it again.
A person's comment carries no marker, so it never makes the run note an issue twice.
It judges a key only from a report it read this run:

| Key | Closes when |
| --- | --- |
| `test:<file> > <describe> > <name>` | this run read a JUnit report, the test is not failing, and `<file>`'s worker did not crash |
| `test:<file>` | this run read a JUnit report and `<file>`'s worker did not crash |
| `gates:<gate>` | this run read a lint log that passes or names its failed gates, and `<gate>` is not among them |
| `mutation-report:<path>` | this run read the mutation report at `<path>` |
| `mutation:<file>` | never |

A crashed worker loses every result of its file, so the issue of a test in that file stays open.
A lint log that is undecided or never finished says nothing of any one gate, so every gate issue stays open.
A mutation finding is a fall from one run to the next.
A later run that does not fall again still holds the lower score.
Only a run that compared scores with every requested mutation report present comments on the mutation issue without closing it, since a score can recover and drop again.
So a person closes a mutation issue once the score is back.
An issue with no key in its body is never read, so a person's issue under the `whole-tree-run` label is never commented on or closed.
A run off `main` comments on and closes no issue.
Agents and people fix each issue as a task of its own, so no pull request waits for a whole-tree run.
A run on any ref but `refs/heads/main` files no issue and records no score, and lists each finding in its log only.

## What it reads

It reads this run's Stryker `mutation.json` reports and any number of JUnit reports, such as the ones `checks-test --junit=<file>` keeps, as [checks-test](checks-test.md#arguments) says.
It reads the lint log `--gates` names for the `gate(s) failed:` line `checks-lint --whole-tree` prints.
It scans the newest 30 successful runs of the same workflow on `main` from newest to oldest.
It takes the first run whose `whole-tree-run` artifact still exists as the previous run.
That artifact holds `whole-tree-run.json`, the scores the run recorded.
When no scanned run holds the artifact it compares no score.
A run on another branch never becomes the previous run.
On `main` with every mutation report present it writes this run's scores to `reports/whole-tree-run.json`, and the workflow uploads that file as the `whole-tree-run` artifact.
It reads the run from `GITHUB_SERVER_URL`, `GITHUB_REPOSITORY`, `GITHUB_RUN_ID`, `GITHUB_WORKFLOW_REF` and `GITHUB_REF`, so it runs only inside a GitHub Actions job.
It calls `gh` with the job's `GH_TOKEN`, which needs `actions: read` for the previous run and `issues: write` for the issues.

## Arguments

```sh
checks-whole-tree-run [--mutation <mutation-report>]... [--tests <junit-report>]... [--gates <lint-log>]
```

`--mutation` names one of this run's Stryker reports and is given once per report the workflow's mutation jobs write, whether or not each job wrote it.
`--tests` names one JUnit report and is given once per report.
`--gates` names this run's `checks-lint --whole-tree` log and is given at most once.
At least one report is given.

## Exit codes

| Code | When |
| --- | --- |
| 0 | it filed every finding, closed each issue whose finding is gone and recorded this run's scores, it found nothing to file, or the run is off `main` and it listed each finding |
| 2 | an argument does not parse, a report or the lint log does not decode, a GitHub Actions variable is unset or a `gh` call fails |

It never exits 1, because a finding becomes an issue rather than a failed run.

## Sample output

```
checks-whole-tree-run: the whole-tree run https://github.com/acme/widget/actions/runs/12 compared with the whole-tree run https://github.com/acme/widget/actions/runs/11; 2 finding(s)
  opened #31 for mutation:src/cart.ts
  commented on #27 for test:tests/unit/cart.test.ts > totals > rounds half to even
  closed #24 for gates:checks-repetition
checks-whole-tree-run: recorded 42 file score(s) in reports/whole-tree-run.json
```

## When it runs

Only a whole-tree workflow the repository writes runs it, after that workflow's full mutation run, its long test tiers and its whole-tree lint gates.

## What each repository runs

`checks-suppressions-ratchet` and `checks-quarantine-clock` run on every pull request, since `checks-lint` judges each pull request's range with them like every other range gate.
`checks-repetition` runs on every pull request in a repository that tracks TypeScript.
`checks-lint-coverage` reads the working tree, so a pull request run judges it only when the change selects the tree gates.
On `main`, the `mutation` caller runs a full mutation run in `refresh` mode, which starts by hand every 28 days.
A `baseline` run without saved state tests every mutant too.
No workflow under `.github/workflows` in checks, skills, career, dotfiles, home-vpn, orc or shopping runs the whole-tree sweep or the issue filing.

The whole-tree sweep runs only by hand through `checks-lint --whole-tree`.
Nothing files issues until a repository adds a `whole-tree-run` workflow.

## Running it by hand

A repository runs it from a workflow named `whole-tree-run`, which someone starts with `gh workflow run whole-tree-run`.
The workflow holds no schedule, since [checks-ci-wiring](checks-ci-wiring.md#schedules) refuses one:

```yaml
name: whole-tree-run
on:
  workflow_dispatch:
permissions:
  contents: read
concurrency:
  group: whole-tree-run
  cancel-in-progress: false
jobs:
  mutation:
    uses: avi2d/workflows/.github/workflows/mutation.yml@v1
    permissions: { contents: read, actions: write, pull-requests: write }
    with:
      mode: refresh
  tests:
    runs-on: ubuntu-latest
    timeout-minutes: 20
    steps:
      - uses: actions/checkout@v5
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version-file: .bun-version
      - run: bun install --frozen-lockfile
      - run: |
          bunx checks-test --tier=live --junit=reports/whole-tree-run-tests/live.xml || true
          bunx checks-test --tier=pixel --junit=reports/whole-tree-run-tests/pixel.xml || true
      - uses: actions/upload-artifact@v4
        with:
          name: whole-tree-run-tests
          path: reports/whole-tree-run-tests/
          retention-days: 1
  gates:
    runs-on: ubuntu-latest
    timeout-minutes: 20
    steps:
      - uses: actions/checkout@v5
        with:
          fetch-depth: 0
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version-file: .bun-version
      - run: bun install --frozen-lockfile
      - run: mkdir -p reports/whole-tree-run-gates && bunx checks-lint --whole-tree > reports/whole-tree-run-gates/gates.log 2>&1 || true
      - uses: actions/upload-artifact@v4
        with:
          name: whole-tree-run-gates
          path: reports/whole-tree-run-gates/
          retention-days: 1
  report:
    needs: [mutation, gates, tests]
    if: ${{ !cancelled() && needs.tests.result == 'success' }}
    runs-on: ubuntu-latest
    timeout-minutes: 15
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
      - uses: actions/download-artifact@v4
        with:
          pattern: mutation-refresh
          path: reports/mutation
      - if: needs.gates.result == 'success'
        uses: actions/download-artifact@v4
        with:
          name: whole-tree-run-gates
          path: reports/whole-tree-run-gates
      - uses: actions/download-artifact@v4
        with:
          name: whole-tree-run-tests
          path: reports/whole-tree-run-tests
      - env:
          GH_TOKEN: ${{ github.token }}
        run: bunx checks-whole-tree-run --mutation reports/mutation/mutation-refresh/mutation.json --tests reports/whole-tree-run-tests/live.xml --tests reports/whole-tree-run-tests/pixel.xml ${{ needs.gates.result == 'success' && '--gates reports/whole-tree-run-gates/gates.log' || '' }}
      - uses: actions/upload-artifact@v4
        with:
          name: whole-tree-run
          path: reports/whole-tree-run.json
          if-no-files-found: ignore
          retention-days: 90
```

The tests job runs each long tier the repository holds, `live` and `pixel` as [checks-test](checks-test.md#test-tiers) names them, and keeps each JUnit report.
Each `|| true` lets the job go on to the upload after a failing test, since that test becomes an issue.
A tier that writes no report fails the report job, because `checks-whole-tree-run` cannot read it.
The gates job runs the whole-tree lint gates and keeps the log, since a failing gate becomes an issue.
The report job runs whenever the tests job succeeds, so a failing test that also stops Stryker still becomes an issue.
It always passes `--mutation`, so a mutation job that failed or timed out leaves a missing report that becomes an issue.
The download names the artifact by `pattern`, which downloads nothing rather than failing when the artifact is missing.
The mutation job is the shared workflow's `refresh` mode, since [checks-ci-wiring](checks-ci-wiring.md#mutation-jobs) refuses a mutation job of the repository's own.
That mode splits the full run into shards and uploads the merged report as the `mutation-refresh` artifact.
It passes `--gates` only when the gates job succeeded, and the failed gates job still fails the run.
The concurrency group queues a run behind one already going, so two runs never file the same finding twice.
A dispatch on a branch runs both jobs and lists its findings in the report job's log, and `if-no-files-found: ignore` lets that run upload no record.
`issues: write` on the report job is the one permission beyond reading the repository and its runs.
A public repository keeps `runs-on: ubuntu-latest` on the tests, gates, and report jobs.
A private repository sets `runs-on: ${{ vars.CI_RUNS_ON || 'ubuntu-latest' }}` on them instead.
A successful run with every mutation report present uploads `whole-tree-run`, so the next run compares with it, and a run that failed or missed a report uploads nothing a later run reads.
The artifact keeps 90 days, so a gap of runs still leaves a previous run to compare with.

## Related topics

- [checks-test](checks-test.md)
- [checks-mutation](checks-mutation.md)
- [checks-mutation-compare](checks-mutation-compare.md)
- [checks-ci-wiring](checks-ci-wiring.md)
