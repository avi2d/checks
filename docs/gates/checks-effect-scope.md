---
kind: reference
audience: consumers
---
# checks-effect-scope

`checks-effect-scope` writes the Effect paths of `oxlint.config.ts` and the kit's severities into the Effect language service plugin in `tsconfig.json`.
As a gate it fails when either differs from what it would write.

## What it checks

It loads the default export of `oxlint.config.ts`.
An override that names all six Effect rules sets the paths for the scoped diagnostics in `src/quality/presets/effect.language-service.json`.
The `oxc/no-async-await` and `promise/avoid-new` settings also set `asyncFunction` and `newPromise`, whether they appear in the root rules or in an override.
Later matching overrides replace only the severities they set, including `off`.
With `effect: false` and neither paired rule configured, the plugin holds no `overrides`.
The TypeScript project keeps its own file selection, so the shared Effect diagnostics still run outside these paths.
With `--check` it fails when the override or the kit's severities in `tsconfig.json` differ from what it would write, and writes nothing.

## What it reads

It reads `oxlint.config.ts`, `tsconfig.json`, the repository's `.gitignore` files, and Git's `info/exclude`.
It adds paths from oxlint `ignorePatterns` and Git ignore files to the exclusion list for each scoped override.
It supports relative paths, `*`, `?`, and `**`.
A basename glob in `files` or `excludeFiles` matches in every directory unless it starts with `./`.
Brace expansion and character classes are refused.
Use a separate glob for each alternative.
Ignore patterns must be positive, so a pattern that starts with `!` is refused.
Use positive patterns that exclude only the paths you want to skip.
A second oxlint config, `extends`, or `.eslintignore` is refused because it can change the paths or severities the root config describes.
It reads `tsconfig.json` as TypeScript does, so a comment or a trailing comma parses, and refuses one that does not parse as a JSONC object.
It rewrites only the `overrides` value of the `@effect/language-service` plugin and the kit's keys in its `diagnosticSeverity`, as JSON with two spaces of indent.
The six scoped keys belong in overrides, so the gate removes any of those keys from the plugin's top-level `diagnosticSeverity`.
When that value is missing it adds the member, and the plugin, `plugins` or `compilerOptions` holding it, after the last member of each.
Each key of the `diagnosticSeverity` in the kit's `tsconfig.effect.json` gets the kit's value, and a key the repository added stays.
A key a release drops from `tsconfig.effect.json` stays in the repository's entry until the repository removes it.
It refuses a `compilerOptions` or `plugins` set to `null`, or a `diagnosticSeverity` that is not an object, which would leave no place for what it writes.
When no overrides apply, it deletes the `overrides` member and its comma, and leaves the comments beside it.
Every other byte of `tsconfig.json` stays as the repository wrote it.
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
| 0 | `tsconfig.json` holds the Effect paths and the kit's severities, or was written to hold them |
| 1 | with `--check`, `tsconfig.json` holds other Effect paths or other severities for the kit's keys |
| 2 | `oxlint.config.ts` does not load, a path or rule setting cannot be mapped, or `tsconfig.json` does not hold the objects and lists the gate needs |

## Sample output

```
effect-scope: the @effect/language-service entry in tsconfig.json differs from the Effect paths of oxlint.config.ts or the kit's severities; run checks-effect-scope to rewrite them
```

## When it runs

A repository runs `checks-effect-scope` from its `build` script, so CI's `git diff --exit-code` after the build fails on a stale `tsconfig.json` too.
`checks-lint` runs it with `--check` in the full run when the repository tracks `oxlint.config.ts`.

## Related topics

- [The Effect rules](../configs/effect-rules.md)
- [checks-lint](checks-lint.md)
