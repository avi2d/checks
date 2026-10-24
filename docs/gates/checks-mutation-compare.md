---
kind: reference
audience: consumers
---
# checks-mutation-compare

`checks-mutation-compare` compares the mutants of two reports and lists each one that regresses, rather than judging an absolute score.

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
A person starts that step by hand on a branch, and no pull request triggers it or waits for it.
[checks-night-run](checks-night-run.md) judges the mutation score of `main` each night and opens an issue for each file whose score fell.
A repository runs it with `--advisory`, so the comparison stays advisory.
Its lines land only in the CI log.
A full sweep runs in CI and never on a laptop.
Start a baseline with `gh workflow run mutation` and keep its report as an artifact.
The shared preset refuses a full `stryker run` outside CI and names that workflow command instead, as [checks-mutation](checks-mutation.md) says.

## Running it in CI

A person starts a workflow named `mutation-compare` on a branch with `gh workflow run mutation-compare --ref <branch>`.
It compares the head report against a report built at the merge-base with `main` over the same scope:

```yaml
name: mutation-compare
on:
  workflow_dispatch:
jobs:
  mutation-compare:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      actions: read
    steps:
      - uses: actions/checkout@v5
        with:
          fetch-depth: 0
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version-file: .bun-version
      - run: bun install --frozen-lockfile
      - name: Select mutation scope
        env:
          GH_TOKEN: ${{ github.token }}
        run: |
          base="$(git merge-base HEAD origin/main)"
          echo "BASE_SHA=$base" >> "$GITHUB_ENV"
          bunx checks-mutation-baseline --full "$RUNNER_TEMP/baseline-full/mutation.json"
          bunx checks-mutation-scope "$base" "$RUNNER_TEMP/baseline-full/mutation.json" >> "$GITHUB_ENV"
      - if: env.SCOPE == ''
        run: echo "::notice::mutation-compare: nothing in mutation scope changed, so neither Stryker run starts"
      - if: env.SCOPE != ''
        run: bunx stryker run --mutate "$SCOPE"
      - if: env.SCOPE != ''
        run: |
          base_worktree="$RUNNER_TEMP/mutation-base-$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT"
          echo "BASE_WORKTREE=$base_worktree" >> "$GITHUB_ENV"
          git worktree prune
          git worktree add "$base_worktree" "$BASE_SHA"
          (cd "$base_worktree" && bun install --frozen-lockfile && bunx stryker run --mutate "$SCOPE")
      - if: env.SCOPE != ''
        run: bun run checks-mutation-compare --advisory "$BASE_WORKTREE/reports/mutation/mutation.json" reports/mutation/mutation.json
      - if: always() && env.BASE_WORKTREE != ''
        run: |
          git worktree remove --force "$BASE_WORKTREE"
          git worktree prune
```

The scope step picks the files the branch changes and the sources its changed unit tests cover or kill, as [checks-mutation-scope](checks-mutation-scope.md) says.
Neither run mutates a file outside that scope, so the job's time follows the size of the change and not the size of the repository.
Both runs take the same `--mutate "$SCOPE"`, so the two reports hold the same files.
A scope file the merge base lacks matches nothing there, and Stryker still writes a report.
An empty scope skips both runs and the comparison, and the notice names the skip on the run's summary.
A changed unit test with no full baseline on `main` fails the scope step, since no report then says which sources the test covers.
A changed unit test that `main` edited after that baseline widens the scope to every file the `mutate` globs match.
Start a full baseline with `gh workflow run mutation`, as [checks-mutation](checks-mutation.md#running-it-in-ci) shows.
A run with `--mutate` is scoped, so the preset lets it through without `CI=true`.
The base worktree's path carries the run's id and attempt, and the last step removes it even when a run fails, so a runner kept between jobs starts each job clean.
A public repository keeps `runs-on: ubuntu-latest`, as [checks-ci-wiring](checks-ci-wiring.md#runners) allows a public repository on every job.
A private repository sets `runs-on` to the labels it declares in `package.json` under `checks.mutationRunner` instead, which is where it sends its mutation runs.
The job never reads `CI_RUNS_ON`, so an override that moves a repository's other jobs during a runner outage leaves the comparison waiting for those labels.
[checks-ci-wiring](checks-ci-wiring.md#runners) refuses a mutation job that names it in `runs-on`.

## Related topics

- [checks-mutation](checks-mutation.md)
- [checks-mutation-scope](checks-mutation-scope.md)
- [checks-night-run](checks-night-run.md)
- [checks-test-layout](checks-test-layout.md)
