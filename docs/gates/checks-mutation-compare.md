---
kind: reference
audience: consumers
---
# checks-mutation-compare

`checks-mutation-compare` is the gate that fails a pull request when any mutant regresses, rather than judging an absolute score.

## What it checks

A mutant regresses when it is `Killed` or `Timeout` at the base and `Survived` or `NoCoverage` at the head.
The gate matches mutants between the two reports and judges each match, so a lost kill cannot hide behind mutants that move into the score and a mutant leaving the score cannot manufacture a false regression.
A matched mutant that moves into or out of `RuntimeError`, `CompileError`, `Ignored` or `Pending` is reported apart from a regression, because that move only changes which mutants leave the score.
A mutant present in only one report is listed and never fails the comparison.

## How it matches mutants

The gate aligns each file's base and head source, which it reads from the report's copy of the file, by a line diff.
It maps each base mutant to the place its lines moved to in the head, so a line added or removed above a mutant leaves it matched.
It then matches a mutant in the base report to a mutant in the head report by its file, that mapped location, its mutator and its replacement.
Two mutants in the same report can share all four, so the gate also counts the position of each mutant among others with the same four, in the order the report lists them, and adds that position to the key.
A mutant on a line the pull request added, removed or changed has no counterpart in the other report and lands in the unmatched list.
Each list prints in order of file, then line, then column, and a matched mutant prints at its place in the head.

## What it reads

It reads two Stryker `mutation.json` reports, one built at the merge-base and one at the head.
The shared Stryker preset's `json` reporter writes `reports/mutation/mutation.json` in each worktree.

A repository that runs mutation testing installs `@stryker-mutator/core` and `@hughescr/stryker-bun-runner`, then spreads the shipped preset in `stryker.conf.mjs`:

```js
import preset from "@avi2dg/checks/stryker.preset.js";

export default {
  ...preset,
};
```

Keys the repository sets after the spread win.

## Arguments

```sh
checks-mutation-compare [--advisory] <base-report> <head-report>
```

`--advisory`, anywhere among the arguments, prints the same verdict and always exits 0.

## Exit codes

| Code | When |
| --- | --- |
| 0 | no mutant regressed, or `--advisory` is given |
| 1 | a mutant regressed |
| 2 | a report is not a Stryker mutation report, or the arguments do not parse |

## Sample output

It prints the verdict first, then each regression, each move into or out of a status that leaves the score, and each unmatched mutant:

```
mutation-compare: REGRESSION (1 mutant(s))
  regression src/billing.ts:12:5 ConditionalExpression "true": Killed -> Survived
  moved src/loader.ts:4:1 ClassDeclaration "class {}": Killed -> RuntimeError
```

## When it runs

Only a CI step the repository writes runs it.
A repository runs it with `--advisory` for its first month, then drops the flag so it blocks.
A full sweep runs in CI and never on a laptop.
Start a baseline with `gh workflow run mutation` and keep its report as an artifact.
The shared preset refuses a full `stryker run` outside CI and names that workflow command instead, as [checks-mutation](checks-mutation.md) says.

## Running it in CI

It runs on pull requests from a workflow named `mutation-compare`, comparing the head report against a report built at the merge-base:

```yaml
name: mutation-compare
on:
  pull_request:
jobs:
  mutation-compare:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
        with:
          fetch-depth: 0
      - uses: oven-sh/setup-bun@v2
      - run: bun install --frozen-lockfile
      - run: bunx stryker run
      - run: |
          base_worktree="$RUNNER_TEMP/mutation-base-$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT"
          echo "BASE_WORKTREE=$base_worktree" >> "$GITHUB_ENV"
          git worktree prune
          git worktree add "$base_worktree" "$(git merge-base HEAD origin/main)"
          (cd "$base_worktree" && bun install --frozen-lockfile && bunx stryker run)
      - run: bun run checks-mutation-compare --advisory "$BASE_WORKTREE/reports/mutation/mutation.json" reports/mutation/mutation.json
      - if: always() && env.BASE_WORKTREE != ''
        run: |
          git worktree remove --force "$BASE_WORKTREE"
          git worktree prune
```

Both Stryker runs are full sweeps, and GitHub sets `CI=true` on every runner, so the preset lets them through.
The base worktree's path carries the run's id and attempt, and the last step removes it even when a run fails, so a runner kept between jobs starts each job clean.
A public repository keeps `runs-on: ubuntu-latest`, because a pull request from a fork runs its own code on the runner.
A private repository sets `runs-on: [self-hosted, Linux, X64, winbox]` instead, which is the fleet's self-hosted Linux runner where it sends its full sweeps.
The job never reads `CI_RUNS_ON`, so an override that moves a repository's other jobs during a runner outage leaves the comparison waiting for `winbox`.
[checks-ci-wiring](checks-ci-wiring.md#runners) refuses a mutation job that names it in `runs-on`.

## Related topics

- [checks-mutation](checks-mutation.md)
- [checks-test-layout](checks-test-layout.md)
