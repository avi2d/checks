# checks-mutation-compare

`checks-mutation-compare` is the gate that holds every mutant in a pull request to no regression rather than an absolute score, and a reader looks it up to wire mutation testing into CI.

## What it checks

A mutant regresses when it is `Killed` or `Timeout` at the base and `Survived` or `NoCoverage` at the head.
The gate matches mutants between the two reports and judges each match, so a lost kill cannot hide behind mutants that move into the score and a mutant leaving the score cannot manufacture a false regression.
A matched mutant that moves into or out of `RuntimeError` or `CompileError` is reported apart from a regression, because that move only changes which mutants leave the score.
A mutant present in only one report is listed and never fails the comparison.

## How it matches mutants

The gate matches a mutant in the base report to a mutant in the head report by its file, its location, its mutator and its replacement.
Two mutants in the same report can share all four, so the gate also counts the position of each mutant among others with the same file, location, mutator and replacement, in the order the report lists them, and adds that position to the key.
A mutant whose position in that count shifts, because a mutant above it with the same signature was added or removed, has no counterpart in the other report and lands in the unmatched list.

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

It prints the verdict first, then each regression, each move into or out of `RuntimeError` or `CompileError`, and each unmatched mutant:

```
mutation-compare: REGRESSION (1 mutant(s))
  regression src/billing.ts:12:5 ConditionalExpression "true": Killed -> Survived
  moved src/loader.ts:4:1 ClassDeclaration "class {}": Killed -> RuntimeError
```

## Opting out

Nothing runs it but a CI step the repository writes.
A repository runs it with `--advisory` for its first month, then drops the flag so it blocks.

## Running it in CI

It runs on pull requests, comparing the head report against a report built at the merge-base:

```yaml
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
          base="$(git merge-base HEAD origin/main)"
          git worktree add /tmp/mutation-base "$base"
          (cd /tmp/mutation-base && bun install --frozen-lockfile && bunx stryker run)
      - run: bun run checks-mutation-compare --advisory /tmp/mutation-base/reports/mutation/mutation.json reports/mutation/mutation.json
```

## Related topics

- [checks-test-layout](checks-test-layout.md)
