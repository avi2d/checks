---
kind: reference
audience: consumers
---
# checks-effect-scope

`checks-effect-scope` writes the Effect paths of `oxlint.config.ts` and the kit's severities into the Effect language service plugin in `tsconfig.json`.
As a gate it fails when either differs from what it would write.

## What it checks

It loads the default export of `oxlint.config.ts`.
An override that names all six Effect rules, the one the `effect` key of `defineConfig` builds, sets the paths for the scoped diagnostics in `src/quality/presets/effect.language-service.json`.
Each such override becomes one entry under `overrides` of the `@effect/language-service` plugin in `tsconfig.json`, with `files` as its `include`, `excludeFiles` as its `exclude`, and the severities as its `options`.
If all six rules are off, the override turns off all six scoped diagnostics on those paths.
The `oxc/no-async-await` and `promise/avoid-new` settings also set `asyncFunction` and `newPromise`, whether they appear in the root rules or in an override.
Later matching overrides replace only the severities they set, including `off`.
Oxlint severities `allow` and `deny` map to `off` and `error`, and an unsupported scoped rule severity is refused.
With `effect: false` and neither paired rule configured, the plugin holds the shared severities but no `overrides`.
The TypeScript project keeps its own file selection, so the shared Effect diagnostics still run outside these paths.
With `--check` it fails when the override or the kit's severities in `tsconfig.json` differ from what it would write, and writes nothing.

## What it reads

It reads `oxlint.config.ts`, `tsconfig.json`, and tracked and non-ignored untracked `.gitignore` files.
Git ignore discovery uses `git ls-files --cached --others --exclude-standard` without changing the index.
Before Git initialization, it reads the root `.gitignore`, including the one setup writes.
It adds paths from oxlint `ignorePatterns` and those Git ignore files to the exclusion list for each scoped override.
A trailing slash in either ignore source restricts a pattern to directories, including when the pattern ends in `/**/`.
It reads the first line of a `.gitignore` even when the file starts with a UTF-8 byte order mark.
It does not use Git's `info/exclude` for scope exclusions.
It supports relative paths, `*`, `?`, and `**`.
A basename glob in `files` or `excludeFiles` matches in every directory unless it starts with `./`.
In `files` and `excludeFiles`, brace expansion and character classes are refused.
Use a separate glob for each alternative.
A directory selector in `files` or `excludeFiles` must end in `/**`, not a bare directory name.
On every generation and check, the gate examines matching TypeScript paths, including newly added paths.
It refuses a path that oxlint includes but tsgo's wildcard include skips.
These include hidden files and directories and the dependency directories `node_modules`, `bower_components`, and `jspm_packages`.
Name that path explicitly in `files` or exclude its directory with a glob ending in `/**`.
For paths with non-ASCII characters, `?` can match differently because oxlint counts UTF-8 bytes and tsgo counts characters.
When their matches differ, the gate names the pattern and the path.
Use literal paths in place of that pattern.
The gate also refuses a minified file that tsgo includes and oxlint skips.
A filename containing `.min.`, `-min.`, or `_min.` counts as minified.
Add the file to `excludeFiles` or rename it.
It also refuses a directory that matches `excludeFiles` when oxlint still includes a file beneath that directory.
Use a directory glob ending in `/**` to exclude those contents too, or rename that directory.
An ignore pattern with `!`, a character class, braces, or a backslash is refused if it may affect a TypeScript path inside an include.
The gate expands simple non-TypeScript extension classes such as `*.py[cod]` into separate patterns for `*.pyc`, `*.pyo`, and `*.pyd`.
Those patterns exclude matching directories as well as files.
With includes limited to `scripts/**/*.ts`, a negation rooted outside `scripts/` also passes, such as `!.vscode/extensions.json`.
A literal negation also passes when it names a tracked regular file with a non-TypeScript extension relative to its ignore file, such as `!.vscode/extensions.json`.
The path must contain a slash or start with `/` so it cannot match at any depth.
A missing tracked negation target is refused by name, with instructions to restore the file or remove the negation.
Other negations outside a disjoint directory are refused, because a dotted name such as `!.vitepress` can be a directory.
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
| 1 | with `--check`, the plugin is missing or its Effect paths or severities for the kit's keys differ from what the gate would write |
| 2 | `oxlint.config.ts` does not load or has no default config, a scope or ignore pattern or a scoped rule severity cannot be mapped, a path would differ between oxlint and tsgo, a second oxlint config, `extends`, `.eslintignore` or `style` or `restriction` category may change a scoped override, or `tsconfig.json` does not parse, sets `compilerOptions` or `plugins` to `null`, holds a `diagnosticSeverity` that is not an object, or lacks the objects the gate writes into |

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
