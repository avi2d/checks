---
kind: reference
audience: consumers
---
# checks-docs-only

`checks-docs-only` tells whether a change touches only top-level Markdown and Markdown under `docs/`, so a docs-only change skips the full `ci` run.

## What it checks

A change is docs-only when every file it touches is a `.md` file at the top level or under `docs/`, and it touches at least one file.
Markdown anywhere else, such as a test fixture under `tests/` or a template under `dist/`, keeps the full run.
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

The `static` and `unit` jobs of the `ci` workflow append the verdict to `GITHUB_OUTPUT` in a filter step.
Their typecheck and test steps skip when the verdict reads `true`.
The `e2e` job does not read this verdict: `scripts/e2e-skip.ts` skips it for a change of only Markdown and the root `copy.json`, a wider set than this bin's.
The build, its `git diff --exit-code` and `bun run lint` still run, so `checks-docs` and the generated blocks hold on a docs-only change.
The `checks` job still runs and reports, so its required check stays green on a docs-only change.

## Related topics

- [checks-ci-wiring](checks-ci-wiring.md)
