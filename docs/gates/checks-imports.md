---
kind: reference
audience: consumers
---
# checks-imports

`checks-imports` is the gate that holds a repository's imports to the dependency rules, with the kit's defaults when the repository writes no config.

## What it checks

It runs dependency-cruiser over every tracked `.ts`, `.tsx`, `.mts` and `.cts` file and names each violation with its rule, the importing module and the module it reaches.
It fails on a violation whose rule has `error` severity, and lists a `warn` or `info` violation without failing.
The rules are those [The dependency rules](../configs/dependency-rules.md) lists, plus each rule the repository's config adds.

In a repository whose `package.json` lists `astro` under `dependencies` or `devDependencies`, the kit's defaults leave `no-orphans` out.
The cruise never reads an `.astro` file, so a `.ts` module only a page imports would read as an orphan, and [checks-unused](checks-unused.md) already names each file no entry reaches there, `.astro` imports included.
A repository that wants the rule back lists its own `no-orphans` under `forbidden` in `dependency-cruiser.config.ts`.

## What it reads

It reads the working tree from the repository root.
It cruises against the first config it finds there:

1. `dependency-cruiser.config.ts`, which calls `defineConfig` from `@avi2dg/checks/dependency-cruiser`.
1. A config under one of dependency-cruiser's own names, such as `.dependency-cruiser.cjs`.
1. The kit's defaults, which `defineConfig()` returns with no argument.

It runs dependency-cruiser from the installed kit under Bun, which loads a TypeScript config wherever it sits.

## Arguments

It takes none.

## Exit codes

| Code | When |
| --- | --- |
| 0 | no import breaks an `error` rule |
| 1 | an import breaks an `error` rule |
| 2 | the repository tracks no TypeScript, or dependency-cruiser cannot load the config or run |

## Sample output

```
imports: 2 violation(s) in 36 module(s) cruised against dependency-cruiser.config.ts
  error not-to-dev-dep: src/index.ts → node_modules/effect/dist/index.js
  error no-orphans: src/lonely.ts
```

A passing run counts the modules it cruised:

```
imports: 225 module(s) cruised against dependency-cruiser.config.ts, no violation
```

## When it runs

`checks-lint` runs it when the repository tracks a `.ts` or `.tsx` file, so a repository with no config of its own still has its imports judged.

## Related topics

- [The dependency rules](../configs/dependency-rules.md)
- [checks-lint](checks-lint.md)
