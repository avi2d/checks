---
kind: reference
audience: consumers
---
# checks-repetition

`checks-repetition` refuses an increase in repeated production lines across a commit range.

## What it checks

The gate runs jscpd at 50 tokens and 5 lines against the base and head revisions.
It compares repeated lines for each production file, so a decrease in another file never offsets a rise.
It follows an edited rename back to the original file.
Files outside production are advisory.

## What it reads

The `files` globs of the production size overrides in `.oxlintrc.json` select the files to measure.
The bin reads the base and head commits rather than the working tree's file contents.

## Arguments

```sh
checks-repetition <base-ref> <head-ref>
checks-repetition <ref>
```

## Exit codes

| Code | Result |
| --- | --- |
| 0 | No production file repeated more lines. |
| 1 | At least one production file repeated more lines. |
| 2 | A config or ref is invalid, or jscpd cannot run. |

## Sample output

```
repetition: 1 production file(s) repeat more lines than where the range starts, at 50 tokens and 5 lines:
  src/copy.ts: 10 repeated line(s), up from 0
```

## Opting out

When `.oxlintrc.json` declares no production size override, the gate reports that nothing was measured.

## Related topics

- [Native settings](../configs/native-settings.md)
- [checks-size-budget](checks-size-budget.md)
