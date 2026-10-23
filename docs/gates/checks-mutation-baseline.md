---
kind: reference
audience: consumers
---
# checks-mutation-baseline

`checks-mutation-baseline` restores the newest mutation baseline that `main` published, and deletes superseded baselines after a `main` run.
On a self-hosted runner it keeps each baseline it downloads, so the next job copies it instead.
There it also saves a run's baseline on the runner's disk, so the baseline never counts against the account's Actions storage.

## What it checks

It reads the successful runs of `mutation.yml` on `main`.
Without `--full` it takes the newest of the 20 newest of those runs that a pull request did not start.
It restores the baseline that run saved on the runner's disk, as [The saved baselines](#the-saved-baselines) says.
Without one there, it restores that run's `mutation-baseline` artifact, and takes the run whether or not it holds one.
It tries no older run, so a newest run without the artifact restores nothing.
An artifact without `stryker-incremental.json` counts as no baseline.
It copies `stryker-incremental.json` to the first destination, and `mutation/mutation.json` to the second destination when the artifact holds it.

With `--full` it lists up to 50 `schedule` runs and up to 50 `workflow_dispatch` runs apart, so pushes cannot crowd the full runs out of one list.
It tries those runs newest first, and restores the first `mutation-baseline-full` artifact that has not expired, downloads and holds the report.
It tries no run after that one.
It takes the report from `mutation.json` at the artifact's root, or else from `mutation/mutation.json`, and copies it to the destination.
With an incremental destination it also copies `stryker-incremental.json` when the artifact holds one, so the next full run retests the mutants its changes reach.
The restore then drops each test that reads a changed file and each mutant result for a changed source from the copied state.
It drops non-killed results when any test goes stale, and drops the whole state when the Stryker config or the lockfile changed.
A state that does not parse fails the restore instead of running on unknown results.
Without the state file the report still restores.

It creates the directories each destination needs.

With `--prune` it deletes the repository's superseded baselines instead of restoring one.
It keeps the newest unexpired `mutation-baseline` among the runs the restore reads, and the newest unexpired `mutation-baseline-full` the restore takes first.
A run whose baseline the runner's disk holds stops that search, and every older `mutation-baseline` goes, since the restore reads that run's saved baseline first.
It also keeps the unexpired baselines of the run it runs in, which `GITHUB_RUN_ID` names.
The restore reads only successful runs, so it takes them once that run succeeds.
A failed artifact lookup while it picks what to keep stops it before it deletes anything.
Treating that artifact as absent would delete the one the restore takes.
It deletes only artifacts with exactly those two names in the repository it runs in.
It deletes only unexpired artifacts, since the restore never reads an expired one.
With `--dry-run` it prints what it would delete and what it would keep, and deletes nothing.
It deletes through `gh`, which needs a token that deletes the repository's Actions artifacts, such as `GH_TOKEN: ${{ github.token }}` with `actions: write`.

## What it reads

It reads the runs and their artifacts through `gh`, which needs a token that reads the repository's Actions, such as `GH_TOKEN: ${{ github.token }}` with `actions: read`.
The `mutation-baseline` artifact holds `stryker-incremental.json` and `mutation/mutation.json`, which an upload of `reports/stryker-incremental.json` and `reports/mutation/mutation.json` writes.
The `mutation-baseline-full` artifact holds `mutation.json` and `stryker-incremental.json` at its root, which an upload of `${{ runner.temp }}/full/` writes.
It reads `RUNNER_ENVIRONMENT` and `HOME` to place the runner cache, and `GITHUB_REPOSITORY_ID` to find the saved baselines.
`--save` and `--prune` read `GITHUB_RUN_ID`.

## The runner cache

The cache sits under `$HOME/.cache/avi2dg-checks/mutation-baseline/`.
It lies outside the job's workspace and `RUNNER_TEMP`, so it outlives the job on a self-hosted runner.
Each entry sits at `<repository id>/<artifact name>/<artifact id>/`.
GitHub gives every upload a new artifact id, so an entry under a listed id is never stale.
On a hit the bin copies the files from the entry and downloads nothing.
On a miss it downloads into a staging directory beside the entry and renames it into place.
A job sharing the runner sees an entry whole or not at all.
If the entry already exists, because another job placed it or it lost a file, the bin keeps it and restores from its own download.
After each download it keeps the 2 highest artifact ids for that repository and artifact name, plus the entry it restores from.
It removes the rest.
A 100 MB baseline zip can unpack to about 500 MB, so a repository restoring both artifacts holds about 2 GB.

When `RUNNER_ENVIRONMENT` is `github-hosted`, it downloads into a temporary directory and writes no cache, since a hosted runner starts every job on a fresh machine.
When `HOME` is unset it works the same way, and prints to stderr that the runner cache is disabled.

## The saved baselines

`--save` writes the run's baseline to `$HOME/.cache/avi2dg-checks/mutation-baseline/<repository id>/saved/mutation-baseline/<run id>.json`.
The entry is one JSON file that holds `stryker-incremental.json` and, when given, `mutation/mutation.json`, keyed by those names.
It writes both files without each mutant's `statusReason`.
Stryker puts the test runner's failure message there, which no reader of a baseline uses, and which makes up most of a large report.
A report of about 280 MB comes out at about 5 MB.
The entry lands through a rename beside it, so a job sharing the runner sees it whole or not at all.
A re-run attempt keeps its run's id, so its entry replaces the one an earlier attempt saved.

The restore reads only the successful runs, so a run that saves and then fails leaves an entry no restore reads.
A re-run attempt that succeeds replaces it first.
A restore reads the entry in one open, so a job that removes or replaces it afterwards changes nothing the restore copies.
A restore from the disk removes the entries of runs older than the one it read.
It keeps the entries of newer runs, which may still be running.
A job that picked one of the removed entries and had not opened it yet finds none, and falls back to the artifact.

Every job that restores the baseline must run on the machine that saved it, as the same user.
A job on another machine finds no entry and falls back to the artifact, which the prune deletes once a saved baseline supersedes it.
Losing the disk costs the next `main` run a fresh baseline, since an incremental run with no state tests every mutant.

`--save` refuses on a GitHub-hosted runner, since its disk ends with the job.
There a repository uploads the baseline as an artifact.
It also refuses when `HOME`, `GITHUB_REPOSITORY_ID` or `GITHUB_RUN_ID` is unset.

## Arguments

```sh
checks-mutation-baseline <incremental-dest> [mutation-json-dest]
checks-mutation-baseline --full <mutation-json-dest> [incremental-dest]
checks-mutation-baseline --save <incremental-src> [mutation-json-src]
checks-mutation-baseline --slim <mutation-json-src> <dest>
checks-mutation-baseline --prune [--dry-run]
```

`--full` restores the report of a full run, and its incremental state when given an incremental destination.
`--save` keeps this run's baseline on the runner's disk in place of an upload.
`--slim` writes a report without `statusReason` to `<dest>`, for a report that still goes up as an artifact.
`--prune` deletes superseded baselines after a save or an upload.
`--dry-run` lists what `--prune` would delete, and deletes nothing.

## Exit codes

| Code | When |
| --- | --- |
| 0 | it restored a baseline, found none to restore, saved the baseline or wrote the slim report |
| 2 | the arguments do not parse, `gh` cannot list the runs, the cache cannot be written, another job removed the entry before it was copied, a file to save or slim does not parse, or `--save` runs where it refuses |

A failed artifact lookup or download prints the `gh` error and moves on, as a missing artifact does.
With `--prune`, `0` means it deleted the superseded artifacts, found none, or could not delete some.
`2` means the arguments do not parse, or `gh` cannot list the runs, a run's artifacts or the repository's artifacts.
A failed delete prints a `::warning::` annotation naming the artifact and the `gh` error, moves on, and the summary names the artifacts it could not delete.
A failed delete still exits `0`, since a failed step fails the `main` run and the restore then skips the baseline that run uploaded.
The next `main` run's prune deletes what this one missed.

## Sample output

```
mutation-baseline: restored it from the runner's cache, mutation-baseline artifact 11666313211 from run 38042411822
```

A miss prints `downloaded it into the runner's cache` instead, and a hosted runner prints `downloaded it`.

```
mutation-baseline: saved the mutation-baseline of run 38058558974 on the runner's disk
mutation-baseline: restored it from the runner's disk, mutation-baseline saved by run 38058558974
mutation-baseline: wrote full/mutation.json without statusReason, 4788924 bytes from 272879455
```

```
mutation-baseline: deleted artifacts 11542133901, 11553708473, 11632727585; kept mutation-baseline artifact 11670749656 from run 38055231501
```

With `--dry-run` the summary says what it would delete and what it would keep.

## When it runs

Only a CI step the repository writes runs it.
A baseline job restores the state the previous `main` run left before an incremental Stryker run:

```yaml
- name: Restore previous baseline state
  env:
    GH_TOKEN: ${{ github.token }}
  run: bunx checks-mutation-baseline reports/stryker-incremental.json
```

A baseline job on a self-hosted runner saves the state the incremental run wrote, then on `main` prunes the superseded baselines:

```yaml
- name: Save baseline state
  if: github.ref == 'refs/heads/main'
  run: bunx checks-mutation-baseline --save reports/stryker-incremental.json reports/mutation/mutation.json
- name: Prune superseded baselines
  if: github.ref == 'refs/heads/main'
  env:
    GH_TOKEN: ${{ github.token }}
  run: bunx checks-mutation-baseline --prune
```

The saved baseline uses none of the account's Actions storage, which every private repository's artifacts share.
That storage accrues by the hour over the month, so an artifact deleted early still counts until the month ends.
A baseline job on a GitHub-hosted runner uploads the same two files as a `mutation-baseline` artifact with `retention-days: 7` instead, since the restore reads only the newest `main` run.

A full baseline job restores the previous full state before its incremental Stryker run, so it retests the mutants its changes reach.
The checkout behind that step fetches the full history, so the restore can diff the restored run against `HEAD`:

```yaml
- name: Restore previous full baseline state
  env:
    GH_TOKEN: ${{ github.token }}
  run: bunx checks-mutation-baseline --full reports/mutation/mutation.json reports/stryker-incremental.json
```

The restore reads the repository's Actions through `gh`, so the job that holds it grants `contents: read` and `actions: read`.

A full run uploads its slimmed report and its slimmed state as the `mutation-baseline-full` artifact, which a branch comparison's scope step reads on any runner.
It slims the report and the state first, so the one directory holds about 10 MB in place of about 500 MB:

```yaml
- run: bunx checks-mutation-baseline --slim reports/mutation/mutation.json "$RUNNER_TEMP/full/mutation.json"
- run: bunx checks-mutation-baseline --slim reports/stryker-incremental.json "$RUNNER_TEMP/full/stryker-incremental.json"
- uses: actions/upload-artifact@v4
  with:
    name: mutation-baseline-full
    path: ${{ runner.temp }}/full/
    retention-days: 30
```

The full upload keeps 30 days, so the newest full baseline outlives the gap between full runs.
A branch comparison's scope step loses its coverage when no full baseline outlives the gap.

A branch comparison's scope step restores the full report with `--full`, and [checks-mutation-scope](checks-mutation-scope.md) reads it:

```yaml
- name: Select mutation scope
  env:
    GH_TOKEN: ${{ github.token }}
  run: |
    bunx checks-mutation-baseline --full "$RUNNER_TEMP/baseline-full/mutation.json"
    bunx checks-mutation-scope "$(git merge-base HEAD origin/main)" "$RUNNER_TEMP/baseline-full/mutation.json" >> "$GITHUB_ENV"
```

## Related topics

- [checks-mutation](checks-mutation.md)
- [checks-mutation-compare](checks-mutation-compare.md)
