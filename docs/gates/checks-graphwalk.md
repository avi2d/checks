---
kind: reference
audience: consumers
---
# checks-graphwalk

`checks-graphwalk` is the gate that judges unreferenced files, unused exports and import violations together, running Knip once over the working tree for unreferenced files and unused exports and dependency-cruiser once for import violations, plus Knip once more on the base checkout when the range adds baseline entries.

## What it checks

It runs Knip once with the repository's own configuration and names each `.ts`, `.tsx` or `.astro` file no entry reaches.
It names each exported value and type no file imports from the same run, so one graph build feeds both findings.
It reads only the files, exports and types issue types, so an unused dependency never fails it.
It asks Knip for those issue types itself, so a configuration that narrows `include` or excludes them still judges them.
A configuration that turns the exports or types rules off silences those symbols, so keep both rules on.
A configuration that turns the files rule off still has its files judged.
It holds each reported symbol against `exports-baseline.json`, and fails on any symbol the baseline does not hold.
It fails on any baseline entry the range adds unless Knip reports that same symbol unused at the base, so the baseline records debt that already existed and never debt the range creates.
It fails on any baseline entry Knip no longer reports, so the baseline only shrinks.
It runs dependency-cruiser over every tracked `.ts`, `.tsx`, `.mts` and `.cts` file and names each violation with its rule, the importing module and the module it reaches.
It fails on a violation whose rule has `error` severity, and lists a `warn` or `info` violation without failing.
It fails when the repository tracks no `.ts`, `.tsx`, `.astro`, `.mts` or `.cts` file, since an empty scan would pass without judging anything.
It fails when the repository holds no Knip configuration, since Knip's default entries cannot tell a dead file from an entry point.

In a repository whose `package.json` lists `astro` under `dependencies` or `devDependencies`, the kit's defaults leave `no-orphans` out.
The cruise never reads an `.astro` file, so a `.ts` module only a page imports would read as an orphan.
The unreferenced-files section already names each file no entry reaches there, and it reads `.astro` imports.
A repository that wants the rule back lists its own `no-orphans` under `forbidden` in `dependency-cruiser.config.ts`.

## What it reads

It runs Knip and dependency-cruiser over the working tree, so an uncommitted file is judged like a committed one.
It reads the repository's Knip configuration, which names the entries.
The repository writes `knip.config.ts` with the kit's builder, which requires `entry`, the files nothing imports:

```ts
import { defineConfig } from "@avi2dg/checks/knip";

export default defineConfig({ entry: ["src/index.ts"] });
```

The builder sets `include` to unreferenced files alone, and adds `tests/**/*.test.ts`, `dependency-cruiser.config.ts` and `oxlint.config.ts` to the entries.
In a repository that depends on `astro`, Knip reads `.astro` imports, so a file only an `.astro` entry imports counts as used and an `.astro` file no entry reaches is named.
The gate resolves the Knip binary from the installed kit, so a consumer installs nothing beyond the kit.
It reads `exports-baseline.json` in the repository root, which holds each accepted unused export as a file, kind and name triple.
It reads `exports-baseline.json` again at the base of the range, where a commit without the file counts as empty.
When the range adds baseline entries, it runs Knip again on a temporary checkout of the base and removes the checkout when it ends.
That checkout links the repository's `node_modules`, so a configuration importing the kit's builder loads there too.
It cruises against the first config it finds there:

1. `dependency-cruiser.config.ts`, which calls `defineConfig` from `@avi2dg/checks/dependency-cruiser`.
1. A config under one of dependency-cruiser's own names, such as `.dependency-cruiser.cjs`.
1. The kit's defaults, which `defineConfig()` returns with no argument.

It runs dependency-cruiser from the installed kit under Bun, which loads a TypeScript config wherever it sits.
It leaves out a tracked file the working tree no longer holds.

## Time limits

A run that lasts past 300 seconds stops, prints `graphwalk: timed out after 300s; set CHECKS_GRAPHWALK_TIMEOUT_SECONDS to allow longer` and exits 2.
A dependency-cruiser run that lasts past 120 seconds stops, and the imports section prints `imports: dependency-cruiser timed out after 120s; set CHECKS_DEPCRUISE_TIMEOUT_SECONDS to allow longer` and cannot decide.
`CHECKS_GRAPHWALK_TIMEOUT_SECONDS` and `CHECKS_DEPCRUISE_TIMEOUT_SECONDS` each take a whole number of seconds above 0, and any other value leaves the run or the section undecided.
When a limit passes, the gate sends SIGTERM to the process group of each process it started.
It sends SIGKILL 2 seconds later to any process still in that group, so nothing it started outlives the gate.

## Arguments

```sh
checks-graphwalk
checks-graphwalk <ref>
checks-graphwalk <base-ref> <head-ref>
checks-graphwalk --write
```

With no argument it judges `HEAD` alone.
With one the base is that commit's parent, or the empty tree for a repository's first commit, where nothing counts as already unused.
With two arguments the base is where the head branched off, at their merge-base.
When the checked-out commit is a merge of the head ref and one other commit, as a pull request's default checkout is, the base is that other commit instead.
So under `checks-lint` a pull request's merge checkout is judged against the base branch tip it merges, and a symbol that branch already baselined does not count as added.
With `--write` it records every unused export and type Knip reports into `exports-baseline.json`, the way `oxlint --suppress-all` seeds `oxlint-suppressions.json`.

A repository adopting the gate runs `checks-graphwalk --write` on a branch that changes no source and commits the file it writes.
The gate passes that range, since Knip reports every seeded symbol unused at the base too.
A seed written after the range adds a dead export, or after it removes the last import of one, fails on that symbol.

## Exit codes

| Code | When |
| --- | --- |
| 0 | no file is unreferenced, no symbol is unlisted, added or stale, and no import breaks an `error` rule, or `--write` recorded the baseline |
| 1 | a file is unreferenced, a symbol is unlisted, added or stale, an import breaks an `error` rule, or the repository holds no Knip configuration |
| 2 | a ref does not resolve, a scanner cannot run, the run or dependency-cruiser passes its time limit, or a Knip report, a cruise report or the baseline does not parse |

The gate exits 1 when any section reports a violation, and exits 2 only when no section reports one and at least one section cannot decide.
When the run passes its time limit the gate exits 2 even when a section already reported a violation.

It also exits 2 when the repository tracks no `.ts`, `.tsx`, `.astro`, `.mts` or `.cts` file, or, with `--write`, when it tracks no TypeScript file.
A repository that tracks `.astro` files but no `.ts`, `.tsx`, `.mts` or `.cts` file prints only the unreferenced-files section.

## Sample output

```
unused: 1 unreferenced file(s):
  src/dead.ts
exports: 2 unused export(s) not in exports-baseline.json:
  src/used.ts: unusedExport (export)
  src/used.ts: UnusedOptions (type)
imports: 1 violation(s) in 5 module(s) cruised against the kit's defaults
  error no-orphans: src/dead.ts
```

A passing run counts what each section judged:

```
unused: no unreferenced files among 3 tracked .ts/.tsx/.astro file(s)
exports: no unused exports or types
imports: 3 module(s) cruised against the kit's defaults, no violation
```

A passing run with a held baseline counts what it holds:

```
exports: 2 unused export(s) in exports-baseline.json, and no new ones
```

## When it runs

`checks-lint` runs it over each pull request's range when the repository tracks a `.ts`, `.tsx` or `.astro` file.
Such a repository names its entries in a Knip configuration.

## Related topics

- [checks-lint](checks-lint.md)
- [checks-repetition](checks-repetition.md)
- [The dependency rules](../configs/dependency-rules.md)
