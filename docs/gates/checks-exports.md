---
kind: reference
audience: consumers
---
# checks-exports

`checks-exports` is the gate that refuses an exported value or type nothing imports, and a reader looks it up when Knip names a symbol no file reaches.

## What it checks

It runs Knip with the repository's own configuration and names each exported value and type no file imports.
It reads only the exports and types issue types, so an unreferenced file or an unused dependency never fails it.
It asks Knip for those issue types itself, so a configuration that narrows `include` or excludes them still has its exports judged.
A configuration that turns the exports or types rules off silences those symbols, so keep both rules on.
It holds each reported symbol against `exports-baseline.json`, and fails on any symbol the baseline does not hold.
It fails on any baseline entry the range adds unless Knip reports that same symbol unused at the base, so the baseline records debt that already existed and never debt the range creates.
It fails on any baseline entry Knip no longer reports, so the baseline only shrinks.
It fails when the repository tracks no TypeScript source, since an empty scan would pass without judging anything.
It fails when the repository holds no Knip configuration, since Knip's default entries cannot tell a dead export from a public one.

## What it reads

It runs Knip over the working tree, so an uncommitted file is judged like a committed one.
It reads the repository's Knip configuration, which names the entries.
It reads `exports-baseline.json` in the repository root, which holds each accepted unused export as a file, kind and name triple.
It reads `exports-baseline.json` again at the base of the range, where a commit without the file counts as empty.
When the range adds baseline entries, it runs Knip again on a temporary checkout of the base and removes the checkout when it ends.
That checkout links the repository's `node_modules`, so a configuration importing the kit's base loads there too.
Knip configurations do not extend a package file, so the consumer configuration imports the kit's base and spreads it:

```ts
import base from "@avi2dg/checks/knip-base.json";

export default { ...base, entry: ["src/index.ts", "tests/**/*.test.ts"] };
```

The base in `knip-base.json` reports only unreferenced files.
The gate resolves the Knip binary from the installed kit, so a consumer installs nothing beyond the kit.

## Arguments

```sh
checks-exports <base-ref> <head-ref>
checks-exports <ref>
checks-exports --write
```

With two arguments the base is where the head branched off, at their merge-base.
When the checked-out commit is a merge of the head ref and one other commit, as a pull request's default checkout is, the base is that other commit instead.
So under `checks-lint` a pull request's merge checkout is judged against the base branch tip it merges, and a symbol that branch already baselined does not count as added.
With one the base is that commit's parent, or the empty tree for a repository's first commit, where nothing counts as already unused.
With `--write` it records every unused export and type Knip reports into `exports-baseline.json`, the way `oxlint --suppress-all` seeds `oxlint-suppressions.json`.

## Seeding a baseline

A repository adopting the gate runs `checks-exports --write` on a branch that changes no source and commits the file it writes.
The gate passes that range, since Knip reports every seeded symbol unused at the base too.
A seed written after the range adds a dead export, or after it removes the last import of one, fails on that symbol.

## Exit codes

| Code | When |
| --- | --- |
| 0 | no reported symbol is unlisted, no baseline entry is added or stale, or `--write` recorded the baseline |
| 1 | a reported symbol is unlisted, a baseline entry is added or stale or the repository holds no Knip configuration |
| 2 | a ref does not resolve, the repository tracks no TypeScript source, Knip cannot run, or a report or baseline does not parse |

## Sample output

```
exports: 2 unused export(s) not in exports-baseline.json:
  src/used.ts: unusedExport (export)
  src/used.ts: UnusedOptions (type)
```

A baseline entry the range adds fails when Knip does not report its symbol unused at the base:

```
exports: 1 exports-baseline.json export(s) the range adds that its base did not leave unused, remove the export instead:
  src/used.ts: unusedExport (export)
```

A passing run with a held baseline counts what it holds:

```
exports: 2 unused export(s) in exports-baseline.json, and no new ones
```

A passing run with an empty baseline says so:

```
exports: no unused exports or types
```

## Opting out

`checks-lint` runs this gate only when the repository tracks `.ts` or `.tsx` files.
A repository that tracks one names its entries in a Knip configuration.

## Related topics

- [checks-lint](checks-lint.md)
- [checks-suppressions-ratchet](checks-suppressions-ratchet.md)
- [checks-unused](checks-unused.md)
