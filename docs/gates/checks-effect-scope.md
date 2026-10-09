---
kind: reference
audience: consumers
---
# checks-effect-scope

`checks-effect-scope` writes the Effect paths of `oxlint.config.ts` into the Effect language service override in `tsconfig.json`, and as a gate fails when that override differs from them.

## What it checks

It loads `oxlint.config.ts` and takes the `files` and `excludeFiles` of the override holding the six Effect rules, the one the `effect` key of `defineConfig` builds.
Each such override becomes one entry under `overrides` of the `@effect/language-service` plugin in `tsconfig.json`, with `files` as its `include`, `excludeFiles` as its `exclude`, and the severities in `src/quality/presets/effect.language-service.json` as its `options`.
The `overrides` of that plugin belong to it, and every other key of `tsconfig.json` stays as the repository wrote it.
With `effect: false` the plugin holds no `overrides`.
With `--check` it fails when the override in `tsconfig.json` differs from the one it would write, and writes nothing.

## What it reads

It reads `oxlint.config.ts` and `tsconfig.json` at the repository root.
It reads `tsconfig.json` as TypeScript does, so a comment or a trailing comma parses, and refuses one that does not parse as a JSONC object.
It writes back only the values that change, each as JSON with two spaces of indent.
Every comment and the formatting around them stay as the repository wrote them.
A repository without `tsconfig.json` has no language service to hold the paths, so it passes.

## Arguments

```sh
checks-effect-scope
checks-effect-scope --check
```

With no argument it writes `tsconfig.json`.
With `--check` it only compares.

## Exit codes

| Code | When |
| --- | --- |
| 0 | `tsconfig.json` holds the Effect paths, or was written to hold them |
| 1 | with `--check`, `tsconfig.json` holds other Effect paths |
| 2 | `oxlint.config.ts` does not load, or `tsconfig.json` does not parse |

## Sample output

```
effect-scope: the @effect/language-service overrides in tsconfig.json differ from the Effect paths of oxlint.config.ts; run checks-effect-scope to rewrite them
```

## When it runs

A repository runs `checks-effect-scope` from its `build` script, so CI's `git diff --exit-code` after the build fails on a stale `tsconfig.json` too.
`checks-lint` runs it with `--check` when the repository tracks `oxlint.config.ts`.

## Related topics

- [The Effect rules](../configs/effect-rules.md)
- [checks-lint](checks-lint.md)
