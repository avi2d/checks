# checks-size-budget

`checks-size-budget` is the gate that holds production files to the line budget `quality.json` declares, and a reader looks it up when a file or a function runs over it.

## What it checks

It holds production files to the line budget `quality.json` declares, and lists every other file over it without failing:

```json
"sources": { "production": ["src/**/*.ts"] },
"size": { "fileLines": 400, "functionLines": 100, "applies": "changed" }
```

It runs oxlint with a configuration of two rules and nothing else, `max-lines` at `fileLines` and `max-lines-per-function` at `functionLines`, both counting blank and comment lines.
With `applies` set to `changed` it holds the files under `sources.production` that the range adds or changes, a rename that edits the file included.
With `all` it holds every file under `sources.production`.
A file the range deletes or only renames is not held.
Every other tracked `.ts` or `.tsx` file over the budget, tests and unchanged production files alike, is listed as advisory and never fails the gate.
`.d.ts` files are not measured.

## What it reads

It reads each file from the head commit rather than the working tree, so an uncommitted edit neither fails nor passes a range, and a pull request's merge checkout measures what the pull request holds.
It reads `sources.production` and `size` from `quality.json`.
oxlint must be on `PATH`, as it is under a package script.

## Arguments

```sh
checks-size-budget <base-ref> <head-ref>
checks-size-budget <ref>
```

With two arguments the range starts where the head branched from the base, at their merge-base.
With one it is that commit against its parent, or against the empty tree for a repository's first commit.

## Exit codes

| Code | When |
| --- | --- |
| 0 | every file it holds keeps within the budget |
| 1 | a file it holds runs over the budget |
| 2 | `quality.json` does not decode, a ref does not resolve, or oxlint cannot run |

## Sample output

```
size-budget: 1 overrun(s) of 400 lines per file and 100 per function in the production files the range adds or changes:
  src/billing/ledger.ts:12: The function `settle` has too many lines (131). Maximum allowed is 100.
size-budget: advisory, 1 overrun(s) where the budget does not hold yet:
  tests/e2e/billing.test.ts: File has too many lines (512).
```

## Opting out

A repository that declares no `size` passes.
`quality.json` refuses a `size` without `sources.production`, which would hold nothing, and with `size` declared `checks-quality` refuses a `sources.production` glob that matches no file.
A repository that tracks no `.ts` or `.tsx` file leaves it out of `gates.lint`, as [Gate selection](checks-lint.md#gate-selection) says.
Moving `applies` from `changed` to `all` tightens the budget to every production file, once the advisory list names none.

## Related topics

- [The quality file](../configs/quality-file.md)
- [checks-lint](checks-lint.md)
