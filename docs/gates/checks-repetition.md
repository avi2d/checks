---
kind: reference
audience: consumers
---
# checks-repetition

`checks-repetition` refuses an increase in repeated lines across a commit range, in the files `.jscpd.json` holds.

## What it checks

The gate runs jscpd at 50 tokens and 5 lines against the base and head revisions.
It compares repeated lines for each file, so a decrease in another file never offsets a rise.
It follows an edited rename back to the original file.
A file that repeats lines without a rise is advisory.
On the whole-tree run `checks-lint --whole-tree` scans the head alone with no base, so every file that repeats lines at the head fails until the repetition is removed, and no file is advisory.
A block two bins need goes into a module both import, as `rangeFromArgs` and `checkoutFiles` in `src/core/git.ts` show.
It fails when the head tracks a `.ts` or `.tsx` file and holds no `.jscpd.json`, since a scan of no files would pass without judging anything.

## What it reads

jscpd reads the head's `.jscpd.json` at each end it scans, so its `path` and `ignore` globs select the files to measure.
The kit's default, which the refusal names, measures `src`:
A `path` entry the base revision lacks reads as empty there, so a newly measured folder never fails the scan.

```json
{ "path": ["src"], "format": ["typescript"], "ignore": ["**/*.d.ts"] }
```

A repository whose TypeScript sits outside `src` names its own folders in `path`.

A repository that lists `"css"` in `format` measures its stylesheets the same way, and [checks-frontend-syntax](checks-frontend-syntax.md) leaves CSS repetition to this gate.

The gate sets the 50 tokens and 5 lines itself, over any the file names.
A `threshold` the file names never fails the gate, which reads jscpd's report once the scan finishes.
The bin reads the named commits rather than the working tree's file contents.

## Arguments

```sh
checks-repetition <base-ref> <head-ref>
checks-repetition <ref>
checks-repetition --whole-tree <head-ref>
```

With `--whole-tree` it scans the named head alone, which is the form `checks-lint --whole-tree` runs.

## Exit codes

| Code | Result |
| --- | --- |
| 0 | Across a range, no measured file repeated more lines. With `--whole-tree`, no measured file repeats lines at the head. |
| 1 | Across a range, at least one measured file repeated more lines. With `--whole-tree`, at least one measured file repeats lines at the head. The head tracks TypeScript and holds no `.jscpd.json`. |
| 2 | A config or ref is invalid, or jscpd cannot run. |

## Sample output

```
repetition: 1 file(s) .jscpd.json holds repeat lines at the head, at 50 tokens and 5 lines:
  src/copy.ts: 10 repeated line(s)
    src/copy.ts:1-10 repeats src/ledger.ts:1-10
```

A head that tracks TypeScript and holds no `.jscpd.json` prints:

```
repetition: the head tracks TypeScript and holds no .jscpd.json, so add one such as the kit's default {"path":["src"],"format":["typescript"],"ignore":["**/*.d.ts"]}
```

## When it runs

`checks-lint` runs it over each pull request's range when the repository tracks a `.ts` or `.tsx` file.
`checks-lint --whole-tree` also runs it over the whole tree when someone starts the whole-tree run by hand.
When the head holds no `.jscpd.json` and tracks no TypeScript, as a range given by hand can, the gate reports that no file was measured and passes.

## Related topics

- [checks-frontend-syntax](checks-frontend-syntax.md)
- [Native settings](../configs/native-settings.md)
- [checks-suppressions-ratchet](checks-suppressions-ratchet.md)
