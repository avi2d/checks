---
kind: reference
audience: consumers
---
# checks-mutation-baseline

`checks-mutation-baseline` restores the newest mutation baseline that `main` published, and on a self-hosted runner it keeps each baseline it downloads so the next job copies it instead.

## What it checks

It looks for the newest successful run of `mutation.yml` on `main` that holds a baseline artifact.
Without `--full` it takes the newest of the 20 newest of those runs that a pull request did not start, and restores its `mutation-baseline` artifact.
It tries no older run, so a newest run without the artifact restores nothing.
With `--full` it lists up to 50 `schedule` runs and up to 50 `workflow_dispatch` runs apart, so pushes cannot crowd the full runs out of one list.
It tries those runs newest first and restores the `mutation-baseline-full` artifact of the first one whose artifact has not expired and downloads.
An artifact without `stryker-incremental.json` counts as no baseline.
It copies `stryker-incremental.json` to the first destination, and `mutation/mutation.json` to the second destination when the artifact holds it.
It creates the directories each destination needs.

## What it reads

It reads the runs and their artifacts through `gh`, which needs a token that reads the repository's Actions, such as `GH_TOKEN: ${{ github.token }}` with `actions: read`.
The artifact holds `stryker-incremental.json` and `mutation/mutation.json`, which an upload of `reports/stryker-incremental.json` and `reports/mutation/mutation.json` writes.
It reads `RUNNER_ENVIRONMENT` and `HOME` to place the runner cache.

## The runner cache

The cache sits under `$HOME/.cache/avi2dg-checks/mutation-baseline/`.
It lies outside the job's workspace and `RUNNER_TEMP`, so it outlives the job on a self-hosted runner.
Each entry sits at `<repository id>/<artifact name>/<artifact id>/`.
GitHub gives every upload a new artifact id, so an entry under a listed id is never stale.
On a hit the bin copies the files from the entry and downloads nothing.
On a miss it downloads into a staging directory beside the entry and renames it into place.
A job sharing the runner sees an entry whole or not at all.
After each download it keeps the 2 highest artifact ids for that repository and artifact name, and removes the rest.
A 100 MB baseline zip can unpack to about 500 MB, so a repository restoring both artifacts holds about 2 GB.

When `RUNNER_ENVIRONMENT` is `github-hosted`, it downloads into a temporary directory and writes no cache, since a hosted runner starts every job on a fresh machine.
When `HOME` is unset it works the same way.

## Arguments

```sh
checks-mutation-baseline [--full] <incremental-dest> [mutation-json-dest]
```

`--full` comes first, and restores the report of a run that started with no state.

## Exit codes

| Code | When |
| --- | --- |
| 0 | it restored a baseline, or found none to restore |
| 2 | the arguments do not parse, `gh` cannot list the runs, or the cache cannot be written |

A failed artifact lookup or download prints the `gh` error and moves on, as a missing artifact does.

## Sample output

```
mutation-baseline: restored it from the runner's cache, mutation-baseline artifact 11666313211 from run 38042411822
```

A miss prints `downloaded it into the runner's cache` instead, and a hosted runner prints `downloaded it`.

## When it runs

Only a CI step the repository writes runs it.
A baseline job restores the state the previous `main` run left before an incremental Stryker run:

```yaml
- name: Restore previous baseline state
  env:
    GH_TOKEN: ${{ github.token }}
  run: bunx checks-mutation-baseline reports/stryker-incremental.json
```

A pull request's scope step restores the full report with `--full`.
The full run uploads `reports/stryker-incremental.json` and `reports/mutation/mutation.json` together as `mutation-baseline-full`.

## Related topics

- [checks-mutation](checks-mutation.md)
- [checks-mutation-compare](checks-mutation-compare.md)
