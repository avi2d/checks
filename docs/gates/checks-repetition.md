---
kind: reference
audience: consumers
---
# checks-repetition

`checks-repetition` refuses a rise in repeated lines across a commit range or a clone outside the baseline in a whole-tree scan.

## What it checks

The gate runs jscpd at 50 tokens and 5 lines against the base and head revisions.
It compares repeated lines for each file, so a decrease in another file never offsets a rise.
It follows an edited rename back to the original file.
A file that repeats lines without a rise is advisory.
With `--whole-tree`, the gate scans the named head and reports only clones the head's `.jscpd-baseline.json` does not cover.
jscpd records how many clones share each fingerprint, rather than the files or line numbers where the clones occur.
A clone with a different fingerprint or a copy that exceeds a fingerprint's recorded count fails.
A clone that the scan no longer finds does not fail, even if its fingerprint stays in the baseline.
Without a baseline at the head, every clone fails.
A block two bins need goes into a module both import, as `rangeFromArgs` and `checkoutFiles` in `src/core/git.ts` show.
It fails when the head tracks a `.ts` or `.tsx` file and holds no `.jscpd.json`, since a scan of no files would pass without judging anything.

## What it reads

jscpd reads the head's `.jscpd.json` at each end it scans, so its `path` and `ignore` globs select the files to measure.
The kit's default, which the refusal names, measures `src`:

```json
{ "path": ["src"], "format": ["typescript"], "ignore": ["**/*.d.ts"] }
```

A `path` entry a revision lacks reads as empty there, so a missing folder never fails the scan.

A repository whose TypeScript sits outside `src` names its own folders in `path`.

A repository that lists `"css"` in `format` measures its stylesheets the same way, and [checks-frontend-syntax](checks-frontend-syntax.md) leaves CSS repetition to this gate.

The gate sets the 50 tokens and 5 lines itself, over any the file names.
A `threshold` the file names never fails the gate, which reads jscpd's report once the scan finishes.
The bin reads the named commits rather than the working tree's file contents.
The whole-tree scan ignores jscpd's `baseline`, `baselineFromRef`, and `failOnNewClones` settings in `.jscpd.json`.
Only the root baseline file at the named commit can exempt clones from the whole-tree check.

## Arguments

```sh
checks-repetition <base-ref> <head-ref>
checks-repetition <ref>
checks-repetition --whole-tree <head-ref>
checks-repetition --write-baseline <head-ref>
```

`checks-lint --whole-tree` runs the `--whole-tree` form.
`--write-baseline` scans the named commit with its `.jscpd.json` and replaces the working tree's root `.jscpd-baseline.json` with the fingerprints from that scan.
To record the current clones, run `checks-repetition --write-baseline HEAD` and commit the resulting file.
Range checks do not use the baseline to exempt clones.

## Exit codes

| Code | Result |
| --- | --- |
| 0 | No measured file repeated more lines across the range, no clone exceeds the whole-tree baseline, or the baseline was written. |
| 1 | At least one measured file repeated more lines across the range, or a clone falls outside the whole-tree baseline. The head lacks `.jscpd.json` and either tracks TypeScript or was named with `--write-baseline`. |
| 2 | A config, ref, or baseline is invalid, or the scan or write cannot finish. |

## Sample output

```
repetition: 2 file(s) .jscpd.json holds repeat lines outside .jscpd-baseline.json at the head, at 50 tokens and 5 lines:
  src/copy.ts: 10 repeated line(s)
    src/copy.ts:1-10 repeats src/ledger.ts:1-10
  src/ledger.ts: 10 repeated line(s)
    src/ledger.ts:1-10 repeats src/copy.ts:1-10
```

A head that tracks TypeScript and holds no `.jscpd.json` prints:

```
repetition: the head tracks TypeScript and holds no .jscpd.json, so add one such as the kit's default {"path":["src"],"format":["typescript"],"ignore":["**/*.d.ts"]}
```

## When it runs

`checks-lint` runs it over each pull request's range when the repository tracks a `.ts` or `.tsx` file.
`checks-lint --whole-tree` also runs it over the whole tree when someone starts the whole-tree run by hand.
When the head holds no `.jscpd.json` and tracks no TypeScript, the gate passes with no file measured.
Only a range given by hand reaches this state.

## Related topics

- [checks-frontend-syntax](checks-frontend-syntax.md)
- [Native settings](../configs/native-settings.md)
- [checks-suppressions-ratchet](checks-suppressions-ratchet.md)
