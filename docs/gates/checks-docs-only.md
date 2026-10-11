---
kind: reference
audience: consumers
---
# checks-docs-only

`checks-docs-only` tells whether a change touches only Markdown and `docs/` paths, so a docs-only change skips the full `ci` run.

## What it checks

A change is docs-only when every file it touches ends in `.md` or sits under `docs/`, and it touches at least one file.
A rename counts both sides.
An empty change and a change with no range keep the full run.

## What it reads

It reads the base and head refs from its arguments.
It compares their merge base with the head through `git merge-base` and `git diff`.

## Arguments

```sh
checks-docs-only <base-ref> <head-ref>
```

With no arguments, the bin reports `docs-only=false`.

## Exit codes

| Code | Result |
| --- | --- |
| 0 | The bin classified the change, and the verdict is on stdout. |
| 2 | The range cannot be decoded. |

## Sample output

```
docs-only=true
```

## When it runs

The `ci` job has a filter step that appends the verdict to `GITHUB_OUTPUT`, and each gate step skips when the verdict reads `true`.
The job itself always runs and reports, so every required check stays green on a docs-only change.

## Related topics

- [checks-ci-wiring](checks-ci-wiring.md)
