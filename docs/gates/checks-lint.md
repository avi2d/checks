---
kind: reference
audience: consumers
---
# checks-lint

`checks-lint` runs every applicable gate in the selected set and reports each failure.

## What it checks

It runs the gates under [What runs](../bins.md#what-runs), each in its own process.
It reports each gate's outcome and wall time in seconds after the gate exits.
With `--whole-tree` it runs the four whole-tree gates instead.
It scopes the run to the gates the change reaches, and the full run stays the fallback.
Applicability below selects the full run, and a scoped or desk run selects a subset.
A Markdown change runs the range gates plus `checks-copy`.
A TypeScript source change runs every applicable gate.
A test file classifies as TypeScript, so its change runs every applicable gate too.
Gates requiring tracked TypeScript files begin running when the repository tracks TypeScript.
`checks-lint-coverage` and `checks-graphwalk` also begin running when the repository tracks an `.astro` file.
`checks-advisories` begins running when the repository tracks `bun.lock`.
`checks-lint` defers its scan to the weekly run, so the desk and the pull request fetch no database.
`checks-frontend-syntax` begins running when `checks.config.ts` sets `frontendSyntax`, or when the repository still tracks `frontend-syntax.json` at its root, which the gate then refuses.
`checks-copy` begins running when `checks.config.ts` sets `copy`, or when the repository still tracks `copy.json` at its root, which the gate then refuses.
`checks-css-size` begins running when the repository tracks a `*.css` file.
`checks-no-mistakes-test` begins running when the repository tracks `.no-mistakes.yaml` at its root.
All other gates run for every repository.

## Stages

Each gate belongs to one of two stages, by what it reads:

| Stage | Gates |
| --- | --- |
| built | `checks-copy` and `checks-frontend-syntax`, when a declared input matches no tracked file and every unmatched input has a static prefix git ignores |
| source | every other gate |

A build writes files git does not track, so an input that matches no tracked file and whose static prefix git ignores, such as `dist/**/*.html` where `dist/` is ignored, reads build output.
An input that matches no tracked file and whose static prefix git does not ignore keeps the gate in the source stage, where the gate fails naming it.
A gate that reads build output runs whole in the built stage, so its other inputs are checked only where the built stage runs.
A gate whose declared inputs do not decode stays in the source stage, where it fails naming what is wrong.
`--stage source` runs the selected gates of the source stage, and names each gate it leaves to the built stage.
It reads only what a clean checkout holds, so it runs before any build.
`--stage built` runs every applicable gate of the built stage over the working tree, after the build.
It resolves no range, so a shallow checkout serves it.
The built stage fails the gate on an input that matches no file.
A run that never reaches the built stage checks none of that gate's inputs.
With no stage, `checks-lint` runs the gates of both stages.

## What it reads

The range ends at `HEAD` and starts at the merge base with `origin/HEAD` for a local run.
If remote HEAD is absent, the range starts at the default branch GitHub's event names in CI, or at `origin/main`.
A local run with `GITHUB_BASE_REF` set starts at that branch on `origin` instead.
A clone with no remote tracking refs checks `HEAD` alone.
On a pull request the range ends at the event's head commit and starts at its merge base with the event's base branch.
Tree gates read the working tree rather than the range.
With `--whole-tree` the range gates read the whole tree at `HEAD` instead of a range.

## Arguments

```sh
checks-lint
checks-lint [--full | --desk]
checks-lint [--full | --desk] <base-ref> <head-ref>
checks-lint --stage source [--full | --desk] [<base-ref> <head-ref>]
checks-lint --stage built
checks-lint --whole-tree
```

With two arguments, the base and head override range discovery.
`--full` forces the unscoped run.
`--desk` runs the fast tree gates.
`--stage source` and `--stage built` run one stage, as [Stages](#stages) says, and `--stage built` takes no other argument.
With `--whole-tree`, it takes no other arguments and runs the four whole-tree gates over the whole tree.

## Exit codes

| Code | Result |
| --- | --- |
| 0 | Every gate that ran passed. |
| 1 | At least one gate found a violation. |
| 2 | `checks.config.ts` does not load or sets an unknown key, the range could not resolve or no failed gate could decide. |

## Sample output

<!-- generated lint-sample: bun run build writes it from KIT_GATES in src/core/gates.ts and scripts/doc-blocks.ts -->

```
checks-lint: range 2504acf098d120e73a8ece3c96f22b934f35c6a8..10ba7d8935b73ed72624120a1542e51bd21ca7c7 from HEAD against origin/main
checks-lint: 1 of 19 gate(s) failed: checks-comment-gate
```

<!-- end generated lint-sample -->

## When it runs

A repository runs it from `bun run lint` in a pull request workflow that fetches the whole git history.
It leaves out the TypeScript gates while the repository tracks no TypeScript file, except that `checks-lint-coverage` and `checks-graphwalk` run when it tracks an `.astro` file.
It never runs `checks-browser`, which a product runs after it builds its site.
A product that declares copy over its built pages runs `checks-lint --stage source` before its build and `checks-lint --stage built` right after it.
A pull request run scopes the gates to the change.
A pull request run judges the three range whole-tree gates over its range like every other range gate.
It judges `checks-lint-coverage` only when the change selects the tree gates, since that gate reads the working tree.
Someone runs the four whole-tree gates over the whole tree by hand with `checks-lint --whole-tree`, from a whole-tree-run workflow or from a local shell.

## Related topics

- [What runs](../bins.md#what-runs)
- [checks-ci-wiring](checks-ci-wiring.md)
