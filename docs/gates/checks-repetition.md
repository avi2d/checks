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

## What it reads

jscpd reads the head's `.jscpd.json` at both ends, so its `path` and `ignore` globs select the files to measure.
A `path` entry the base revision lacks reads as empty there, so a newly measured folder never fails the scan.

```json
{ "path": ["src"], "format": ["typescript"], "ignore": ["**/*.d.ts"] }
```

The gate sets the 50 tokens and 5 lines itself, over any the file names.
A `threshold` the file names never fails the gate, which reads jscpd's report once the scan finishes.
The bin reads the base and head commits rather than the working tree's file contents.

## Arguments

```sh
checks-repetition <base-ref> <head-ref>
checks-repetition <ref>
```

## Exit codes

| Code | Result |
| --- | --- |
| 0 | No measured file repeated more lines. |
| 1 | At least one measured file repeated more lines. |
| 2 | A config or ref is invalid, or jscpd cannot run. |

## Sample output

```
repetition: 1 file(s) .jscpd.json holds repeat more lines than where the range starts, at 50 tokens and 5 lines:
  src/copy.ts: 10 repeated line(s), up from 0
```

## When it runs

`checks-lint` runs it over each pull request's range when the repository tracks a `.ts` or `.tsx` file.
When the head holds no `.jscpd.json`, the gate reports that no file was measured.

## Related topics

- [Native settings](../configs/native-settings.md)
- [checks-suppressions-ratchet](checks-suppressions-ratchet.md)
