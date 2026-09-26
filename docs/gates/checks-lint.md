---
kind: reference
audience: consumers
---
# checks-lint

`checks-lint` runs every applicable kit lint gate over one range and reports each failure.

## What it checks

It runs the gates under [What runs](../../README.md#what-runs) in table order, each in its own process.
Gates requiring tracked TypeScript files begin running when the repository tracks TypeScript.
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

```
checks-lint: range 2504acf098d120e73a8ece3c96f22b934f35c6a8..10ba7d8935b73ed72624120a1542e51bd21ca7c7 from HEAD against origin/main
checks-lint: 1 of 9 gate(s) failed: checks-comment-gate
```

## Opting out

A repository runs `checks-lint` in a pull request workflow with the full git history fetched.
The gate automatically omits TypeScript gates when no TypeScript file is tracked.

## Related topics

- [What runs](../../README.md#what-runs)
- [checks-ci-wiring](checks-ci-wiring.md)
