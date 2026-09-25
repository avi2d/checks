# checks-mutation-compare

`checks-mutation-compare` is the gate that holds a pull request's mutation score to no regression rather than an absolute threshold, and a reader looks it up to wire mutation testing into CI.

## What it checks

The head mutation score may not fall below the score at the merge-base.
The score is Stryker's, `Killed` and `Timeout` over those plus `Survived` and `NoCoverage`, so `CompileError`, `RuntimeError`, `Ignored` and `Pending` mutants leave it.
Every file in a report counts toward that report's score, including files present in only one of the two.

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
| 0 | the head score is not below the base score, or `--advisory` is given |
| 1 | the head score is below the base score |
| 2 | a report is not a Stryker mutation report, or the arguments do not parse |

## Sample output

It prints the overall score of each report and the per-file scores that differ:

```
mutation-compare: base 83.33% (5/6) head 66.67% (4/6) delta -16.67pp
  src/billing.ts: 75.00% (3/4) -> 50.00% (2/4)
  1 unchanged file(s)
mutation-compare: REGRESSION (-16.67pp)
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
