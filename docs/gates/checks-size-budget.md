# checks-size-budget

`checks-size-budget` is the gate that holds production and test files to the size budget `quality.json` declares, and a reader looks it up when a file or a function runs over it.

## What it checks

It holds production and test files to the size budget, and lists every other file over it without failing:

```json
"sources": { "production": ["src/**/*.ts"] },
"size": { "applies": "ratchet" }
```

A production file is one under `sources.production`, and a test file is a tracked `.ts` or `.tsx` file under `tests/`.
A test file keeps to the tests budget, and every other file keeps to the production budget.
It runs oxlint with a configuration of five rules and nothing else, one for each limit.
The kit sets each limit:

<!-- generated size-limits: bun run build writes it from SIZE_RULES and SIZE_DEFAULTS in scripts/size-rules.ts and scripts/doc-blocks.ts -->

| Key | Limits | oxlint rule | Production | Tests |
| --- | --- | --- | --- | --- |
| `fileLines` | The most lines a file may hold, blank and comment lines counted | `max-lines` | 400 | 600 |
| `functionLines` | The most lines a function may span, blank and comment lines counted | `max-lines-per-function` | 100 | none |
| `statements` | The most statements a function may hold | `max-statements` | 30 | 50 |
| `complexity` | The highest cyclomatic complexity a function may reach, a switch counted once | `complexity` | 15 | 15 |
| `depth` | The deepest a block may nest inside a function | `max-depth` | 4 | 4 |

<!-- end generated size-limits -->

`size.production` and `size.tests` state only a limit that differs from the kit's:

```json
"size": {
  "applies": "ratchet",
  "production": { "complexity": 12 },
  "tests": { "fileLines": 800 }
}
```

`applies` decides which files the gate holds and what fails them:

- `ratchet` holds each production and test file the range adds or changes, a rename that edits the file included.
  For each file and each rule, it sums how far every site runs over its limit, and fails when that sum is higher at the head than at the base of the range.
  A file the range adds starts from zero, so it has to keep within the budget.
  A file already over the budget passes while its overrun does not grow, and an edit that shrinks the overrun passes.
  An edited rename is compared with the file it was renamed from.
  Nothing is committed as a baseline, because the base of the range holds it.
- `all` holds every production and test file, and fails on any overrun in them.

`applies` is `ratchet` when `size` leaves it out.
A file the range deletes or only renames is not held.
Every other tracked `.ts` or `.tsx` file over the budget, tooling and unchanged files alike, is listed as advisory and never fails the gate.
Under `ratchet` the advisory list also names each site in a held file whose overrun did not grow.
`.d.ts` files are not measured.

`quality.json` refuses `applies: "changed"`, which `ratchet` replaces.
It refuses a limit set directly under `size`, since each limit goes in `size.production` or `size.tests`.

## What it reads

It reads each file from the head commit rather than the working tree, so an uncommitted edit neither fails nor passes a range, and a pull request's merge checkout measures what the pull request holds.
Under `ratchet` it also reads each held file from the base of the range, under the path the file has at the head, so a file keeps the same budget at both ends.
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
| 0 | every file it holds keeps within the budget, or under `ratchet` no file's overrun grows |
| 1 | a file it holds runs over the budget, or under `ratchet` a file's overrun grows |
| 2 | `quality.json` does not decode, a ref does not resolve, or oxlint cannot run |

## Sample output

```
size-budget: 2 overrun(s) grew past the base in the production and test files the range adds or changes:
  src/billing/invoice.ts: max-lines over by 31 in total, up from 19
    src/billing/invoice.ts: File has too many lines (431). Maximum allowed is 400.
  src/billing/ledger.ts: complexity over by 3 in total, up from 0
    src/billing/ledger.ts:12: function `settle` has a complexity of 18. Maximum allowed is 15.
size-budget: advisory, 1 overrun(s) where the budget does not hold yet:
  tests/e2e/billing.test.ts: File has too many lines (612). Maximum allowed is 600.
```

## Opting out

A repository that declares no `size` passes.
`quality.json` refuses a `size` without `sources.production`, and with `size` declared `checks-quality` refuses a `sources.production` glob that matches no file.
A repository that tracks no `.ts` or `.tsx` file leaves it out of `gates.lint`, as [Gate selection](checks-lint.md#gate-selection) says.
Moving `applies` from `ratchet` to `all` tightens the budget to every production and test file, once the advisory list names none.

## Related topics

- [The quality file](../configs/quality-file.md)
- [checks-lint](checks-lint.md)
