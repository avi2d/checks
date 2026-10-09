---
kind: reference
audience: consumers
---
# checks-unused

`checks-unused` is the gate that refuses a TypeScript or Astro file no entry point reaches.

## What it checks

It runs Knip with the repository's own configuration and names each `.ts`, `.tsx` or `.astro` file no entry reaches.
It reads only the files issue type, so an unused export or dependency never fails it.
It asks Knip for that issue type itself, so a configuration that narrows `include`, excludes files or turns the files rule off still has its files judged.
It fails when the repository tracks no `.ts`, `.tsx` or `.astro` file, since an empty scan would pass without judging anything.
It fails when the repository holds no Knip configuration, since Knip's default entries cannot tell a dead file from an entry point.

## What it reads

It reads the working tree, so an uncommitted file is judged like a committed one.
It reads the repository's Knip configuration, which names the entries.
The repository writes `knip.config.ts` with the kit's builder, which requires `entry`, the files nothing imports:

```ts
import { defineConfig } from "@avi2dg/checks/knip";

export default defineConfig({ entry: ["src/index.ts"] });
```

The builder sets `include` to unreferenced files alone, and adds `tests/**/*.test.ts` and `dependency-cruiser.config.ts` to the entries.
In a repository that depends on `astro`, Knip reads `.astro` imports, so a file only an `.astro` entry imports counts as used and an `.astro` file no entry reaches is named.
The gate resolves the Knip binary from the installed kit, so a consumer installs nothing beyond the kit.

## Arguments

It takes none.

## Exit codes

| Code | When |
| --- | --- |
| 0 | no tracked file is unreferenced |
| 1 | a tracked file is unreferenced or the repository holds no Knip configuration |
| 2 | the repository tracks no TypeScript or Astro source, Knip cannot run, or its configuration does not parse |

## Sample output

```
unused: 1 unreferenced file(s):
  src/planted-dead.ts
```

A passing run counts the files it judged:

```
unused: no unreferenced files among 110 tracked .ts/.tsx/.astro file(s)
```

## When it runs

`checks-lint` runs it when the repository tracks a `.ts`, `.tsx` or `.astro` file.
Such a repository names its entries in a Knip configuration.

## Related topics

- [checks-lint](checks-lint.md)
- [checks-repetition](checks-repetition.md)
