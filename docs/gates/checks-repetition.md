# checks-repetition

`checks-repetition` is the gate that fails a change adding repeated lines to production code, and a reader looks it up when a production file repeats more lines than it did where the range starts.

## What it checks

It runs jscpd over the files `quality.json` declares as production:

```json
"sources": { "production": ["src/**/*.ts"] }
```

jscpd finds each block of at least 50 tokens and 5 lines that appears twice, within one file or across two.
A repeated line is a line of a file inside such a block.
The gate counts the repeated lines of each production file at the head and where the range starts, and fails when a file counts more at the head.
A renamed file is compared with its count under the old path.
A block counts only when both copies are in production files, so a test that copies production code changes no count.
Each file whose count rose is listed with the blocks it repeats and where the other copy is.

Every other file that repeats lines is listed as advisory and never fails the gate.
The advisory list names the production files whose count did not rise, and every other tracked `.ts` or `.tsx` file that repeats a block within itself or from another such file.
`.d.ts` files are not measured.
Nothing is committed as a baseline, because each run measures where the range starts as well as the head.

## What it reads

It reads each file from the commits at the two ends of the range rather than the working tree, so an uncommitted edit neither fails nor passes a range, and a pull request's merge checkout measures what the pull request holds.
It reads `sources.production` from `quality.json`.
jscpd must be on `PATH`, as it is under a package script.

## Arguments

```sh
checks-repetition <base-ref> <head-ref>
checks-repetition <ref>
```

With two arguments the range starts where the head branched from the base, at their merge-base.
With one it is that commit against its parent, or against the empty tree for a repository's first commit.

## Exit codes

| Code | When |
| --- | --- |
| 0 | no production file repeats more lines than where the range starts |
| 1 | a production file repeats more lines than where the range starts |
| 2 | `quality.json` does not decode, a ref does not resolve, or jscpd cannot run |

## Sample output

```
repetition: 1 production file(s) repeat more lines than where the range starts, at 50 tokens and 5 lines:
  src/billing/refund.ts: 11 repeated line(s), up from 0
    src/billing/refund.ts:1-11 repeats src/billing/legacy.ts:1-11
repetition: advisory, 4 file(s) repeat lines the hold does not fail:
  src/billing/ledger.ts: 11 repeated line(s)
  src/billing/legacy.ts: 21 repeated line(s)
  tests/one.test.ts: 11 repeated line(s)
  tests/two.test.ts: 11 repeated line(s)
```

## Opting out

A repository that declares no `sources.production` passes.
`checks-quality` refuses a `sources.production` glob that matches no file.
A repository that tracks no `.ts` or `.tsx` file leaves it out of `gates.lint`, as [Gate selection](checks-lint.md#gate-selection) says.

## Related topics

- [The quality file](../configs/quality-file.md)
- [checks-size-budget](checks-size-budget.md)
- [checks-lint](checks-lint.md)
