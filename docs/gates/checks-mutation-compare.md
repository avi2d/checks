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
The comparison covers only the files the head report holds.
A file the head report lacks is out of scope and is not listed.
A mutant in a covered file with no counterpart in the other report is listed and never fails the comparison.

## How it matches mutants

The gate aligns each file's base and head source, which it reads from the report's copy of the file, by a line diff.
It maps each base mutant to the place its lines moved to in the head, so a line added or removed above a mutant leaves it matched.
It then matches a mutant in the base report to a mutant in the head report by its file, that mapped location, its mutator and its replacement.
Two mutants in the same report can share all four, so the gate also counts the position of each mutant among others with the same four, in the order the report lists them, and adds that position to the key.
A mutant on a line the pull request added, removed or changed has no counterpart in the other report and lands in the unmatched list.
A branch behind `main` can report a matched mutant as a regression when `main` gained the kill after the branch point.
Each list prints in order of file, then line, then column, and a matched mutant prints at its place in the head.

## What it reads

It reads two Stryker `mutation.json` reports, the newest saved `main` baseline and the incremental head report from the pull request head.
The shared Stryker preset's `json` reporter writes `reports/mutation/mutation.json` in the worktree.

A repository that runs mutation testing installs `@stryker-mutator/core` and `@hughescr/stryker-bun-runner`, then spreads the shipped preset in `stryker.conf.mjs`.
[checks-setup](checks-setup.md) writes both pins and this config:

```js
import preset from "@avi2dg/checks/stryker.preset.js";

export default { ...preset, mutate: ["src/**/*.{ts,tsx}", "!src/**/*.test.{ts,tsx}"] };
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

No caller-started run invokes it.
On a pull request the shared workflow runs a scoped Stryker run over the changed files and posts a score comment for those files.
[checks-whole-tree-run](checks-whole-tree-run.md) judges the mutation score of `main` on each whole-tree run and opens an issue for each file whose score fell.
Run it by hand to compare two Stryker reports.
A full sweep runs in CI and never on a laptop.
Refresh the full baseline with `gh workflow run mutation`.
The shared preset refuses a full `stryker run` outside CI and names that workflow command instead, as [checks-mutation](checks-mutation.md) says.

## Running it in CI

No caller-started run invokes it, since the shared pull request run scores the scope instead of comparing reports.
Only `avi2d/workflows` holds the shared workflow, so each other repository calls it from the caller [checks-setup](checks-setup.md) writes.
The shared pull request run runs Stryker once at the pull request head over that scope without reading `main`.
The shared workflow picks `compare` from the event on each pull request.

The shared pull request run calls `checks-mutation-scope` with no report, so the scope holds the files the branch changes, as [checks-mutation-scope](checks-mutation-scope.md) says.
No changed unit test widens that scope.
A caller that passes a full baseline report also picks the sources its changed unit tests cover or kill.
The head run mutates no file outside that scope.
The job time follows the size of the change and not the size of the repository.
An empty scope skips the head run and the comparison, and the notice names the skip on the run's summary.
A scope past the mutant cap skips the comparison, and a note names the skip.
A changed unit test with no full baseline on `main` adds no covered source to the scope.
With no other change the scope stays empty and the comparison skips.
With a report, a changed unit test that `main` edited after that baseline widens the scope to every file the `mutate` globs match.
When that report path names no file, refresh the full baseline with `gh workflow run mutation`, as [checks-mutation](checks-mutation.md#running-it-in-ci) shows.
A run with `--mutate` is scoped, so the preset lets it through without `CI=true`.
A public repository keeps `runs-on: ubuntu-latest`, as [checks-ci-wiring](checks-ci-wiring.md#runners) requires of a job a fork can reach.
A private repository runs the comparison on `ubuntu-latest` too, and the job never reads `CI_RUNS_ON`.
[checks-ci-wiring](checks-ci-wiring.md#runners) refuses a mutation job that names it in `runs-on`.

## Related topics

- [checks-mutation](checks-mutation.md)
- [checks-mutation-scope](checks-mutation-scope.md)
- [checks-whole-tree-run](checks-whole-tree-run.md)
- [checks-test-layout](checks-test-layout.md)
