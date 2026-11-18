---
kind: reference
audience: consumers
---
# checks-docs-only

`checks-docs-only` tells whether a change touches only top-level Markdown and Markdown under `docs/`, so a docs-only change skips the full `ci` run.

## What it checks

A change is docs-only when every file it touches is a `.md` file at the top level or under `docs/`, and it touches at least one file.
Markdown anywhere else, such as a test fixture under `tests/` or a template under `dist/`, keeps the typecheck and unit test steps running.
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

The `changes` job of the `ci` workflow runs `checks-ci changes`, which runs this bin and writes its verdict as the `docs-only` output.
On a docs-only change the test jobs skip, and the `checks` job accepts those skips.
The `static` job still runs, so the build, its `git diff --exit-code`, `bun run lint` and `checks-docs` hold on a docs-only change.

## Related topics

- [checks-ci](checks-ci.md)
- [checks-ci-wiring](checks-ci-wiring.md)
