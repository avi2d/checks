---
kind: reference
audience: consumers
---
# checks-lint

`checks-lint` runs every applicable kit lint gate over one range and reports each failure.

## What it checks

It runs the gates under [What runs](../../README.md#what-runs), each in its own process.
Gates requiring tracked TypeScript files begin running when the repository tracks TypeScript.
`checks-lint-coverage` and `checks-unused` also begin running when the repository tracks an `.astro` file.
`checks-advisories` begins running when the repository tracks `bun.lock`.
`checks-frontend-syntax` begins running when the repository tracks `frontend-syntax.json` at its root.
All other gates run for every repository.

## What it reads

The range ends at `HEAD` and starts at the merge base with `origin/HEAD` for a local run.
If remote HEAD is absent, the range starts at the default branch GitHub's event names in CI, or at `origin/main`.
A local run with `GITHUB_BASE_REF` set starts at that branch on `origin` instead.
A clone with no remote tracking refs checks `HEAD` alone.
On a pull request the range ends at the event's head commit and starts at its merge base with the event's base branch.
Tree gates read the working tree rather than the range.

## Arguments

```sh
checks-lint
checks-lint <base-ref> <head-ref>
```

With two arguments, the base and head override range discovery.

## Exit codes

| Code | Result |
| --- | --- |
| 0 | Every applicable gate passed. |
| 1 | At least one gate found a violation. |
| 2 | The range could not resolve or no failed gate could decide. |

## Sample output

<!-- generated lint-sample: bun run build writes it from KIT_GATES in src/core/gates.ts and scripts/doc-blocks.ts -->

```
checks-lint: range 2504acf098d120e73a8ece3c96f22b934f35c6a8..10ba7d8935b73ed72624120a1542e51bd21ca7c7 from HEAD against origin/main
checks-lint: 1 of 14 gate(s) failed: checks-comment-gate
```

<!-- end generated lint-sample -->

## When it runs

A repository runs it from `bun run lint` in a pull request workflow that fetches the whole git history.
It leaves out the TypeScript gates while the repository tracks no TypeScript file, except that `checks-lint-coverage` and `checks-unused` run when it tracks an `.astro` file.
It never runs `checks-browser`, which a product runs after it builds its site.

## Related topics

- [What runs](../../README.md#what-runs)
- [checks-ci-wiring](checks-ci-wiring.md)
