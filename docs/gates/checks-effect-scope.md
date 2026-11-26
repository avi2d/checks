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
If all six rules are off, the override turns off all six scoped diagnostics on those paths.
The `oxc/no-async-await` and `promise/avoid-new` settings also set `asyncFunction` and `newPromise`, whether they appear in the root rules or in an override.
Later matching overrides replace only the severities they set, including `off`.
Oxlint severities `allow` and `deny` map to `off` and `error`, and an unsupported scoped rule severity is refused.
With `effect: false` and neither paired rule configured, the plugin holds no `overrides`.
The TypeScript project keeps its own file selection, so the shared Effect diagnostics still run outside these paths.
With `--check` it fails when the override or the kit's severities in `tsconfig.json` differ from what it would write, and writes nothing.

## What it reads

It reads `oxlint.config.ts`, `tsconfig.json`, and tracked `.gitignore` files.
It adds paths from oxlint `ignorePatterns` and tracked Git ignore files to the exclusion list for each scoped override.
It does not use Git's `info/exclude` or untracked `.gitignore` files for scope exclusions, so the committed output does not depend on clone-local ignores.
It supports relative paths, `*`, `?`, and `**`.
A basename glob in `files` or `excludeFiles` matches in every directory unless it starts with `./`.
In `files` and `excludeFiles`, brace expansion and character classes are refused.
Use a separate glob for each alternative.
A directory selector in `files` or `excludeFiles` must end in `/**`, not a bare directory name.
An ignore pattern with `!`, a character class, braces, or a backslash is refused if it may affect a TypeScript path inside an include.
The gate recognizes simple non-TypeScript extension patterns, including `!.vscode/extensions.json` and `*.py[cod]`.
Patterns under a directory disjoint from every include also pass.
When the gate cannot establish that a pattern is unrelated, it refuses the pattern.
Use positive patterns that exclude only the paths you want to skip.
When scoped overrides exist, a second oxlint config, `extends`, or `.eslintignore` is refused because it can change their paths or severities.
The same condition refuses a `style` or `restriction` category unless it is off, since either category can enable paired rules.
Without scoped overrides, these scope-only checks do not run.
It reads `tsconfig.json` as TypeScript does, so a comment or a trailing comma parses, and refuses one that does not parse as a JSONC object.
It writes the `overrides` value of the `@effect/language-service` plugin and the kit's keys in its `diagnosticSeverity`, as JSON with two spaces of indent.
The six scoped keys belong in overrides, so the gate removes any of those keys from the plugin's top-level `diagnosticSeverity`.
When that value is missing it adds the member, and the plugin, `plugins` or `compilerOptions` holding it, after the last member of each.
Each key of the `diagnosticSeverity` in the kit's `tsconfig.effect.json` gets the kit's value.
A key the repository added stays unless it is one of the six scoped keys.
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
| 2 | `oxlint.config.ts` does not load or has no default config, a scope or ignore pattern or a scoped rule severity cannot be mapped, a second oxlint config, `extends`, `.eslintignore` or `style` or `restriction` category may change a scoped override, or `tsconfig.json` does not parse or lacks the objects the gate writes into |

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
