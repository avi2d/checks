---
kind: reference
audience: consumers
---
# checks-lint-coverage

`checks-lint-coverage` is the gate that fails when oxlint skips a tracked TypeScript or Astro file without saying so.
It also fails when a nested oxlint config turns off an unlisted rule, or when the program `tsconfig.json` builds drops the ts-reset rules.

## What it checks

It fails when oxlint skips a tracked `.ts`, `.tsx` or `.astro` file, for example through a stray `.gitignore` entry.
It compares `git ls-files` against oxlint's own file walk and names the missing files.
It lists each tracked `.astro` file the same way, since oxlint lints the frontmatter and script blocks of an `.astro` file, where a script block loads client code with a side-effect import such as `import "../client.ts";`.

It fails when the program `tsconfig.json` builds leaves out the `is-array` or the `json-parse` rule of `@total-typescript/ts-reset`, which `tsconfig.effect.json` lists.
A `tsconfig.json` that does not extend `@avi2dg/checks/tsconfig.effect.json`, or that sets both `files` and `include`, leaves both rules out.
[The TypeScript rules](../configs/typescript-rules.md) says what the two rules refuse.

It fails when an oxlint config below the repository root turns off a rule that `checks.config.ts` does not list for it, as [Nested oxlint configs](#nested-oxlint-configs) says.

## Nested oxlint configs

oxlint lints the files under a directory that holds a `.oxlintrc.json`, `.oxlintrc.jsonc`, `oxlint.config.ts` or `oxlint.config.mts` with that config in place of the root one.
Such a nested config still lets oxlint walk every file, so the walk alone cannot see a rule it turns off.

The gate checks each tracked `.ts`, `.tsx` and `.astro` file under a nested config.
For each rule the root config sets on for that file, it reads the setting of the nearest nested config:

| Line | The nested config |
| --- | --- |
| `off` | turns the rule off, or leaves it out |
| `down` | sets a lower severity |
| `options` | sets the same severity with other options |

The `nestedOxlintConfigs` key of `checks.config.ts` lists the rules each nested config may turn off, down or to other options, by the config's repository-relative path:

```ts
import { defineConfig } from "@avi2dg/checks/config";

export default defineConfig({
  nestedOxlintConfigs: {
    "packages/app/oxlint.config.ts": ["typescript/no-explicit-any", "max-lines"],
  },
});
```

The gate fails on each rule a nested config turns off that its entry does not list.
It also fails on an entry for a path that holds no tracked nested config.
It fails on a listed rule the config no longer turns off, so the list holds only what each config switches off.
A rule reads as oxlint prints it, so `eslint/max-lines` is `max-lines` and `@typescript-eslint/no-explicit-any` is `typescript/no-explicit-any`.

## What it reads

It reads whether the repository root holds a `package.json`, and skips with a note when none holds, since a repository with no manifest is not a package the gate judges.
It reads the working tree: the `*.ts`, `*.tsx` and `*.astro` files `git ls-files` lists, and the files `oxlint --debug=files` walks.
It walks without naming a path, since an explicit path bypasses the ignore files whose skips it looks for.
It reads the program from `tsc --listFilesOnly -p tsconfig.json`, and passes over the program when the repository tracks no `.ts` or `.tsx` file or the root holds no `tsconfig.json`.
It reads the resolved rules of the root config from `oxlint --print-config`, and those of each nested config from `oxlint -c <config> --print-config`.
That output leaves out the top-level rules of a JS plugin, so the gate reads those from the config file itself.
It does not read a plugin rule a config takes through `extends`.
It reads the `nestedOxlintConfigs` key of `checks.config.ts`, and runs `bun` from `PATH` to load it.
The gate runs oxlint and tsc from the repository's own `node_modules/.bin`, so they need no `PATH` entry.

## Arguments

It takes none.

## Exit codes

| Code | When |
| --- | --- |
| 0 | the repository root holds no `package.json`, the repository tracks no `.ts`, `.tsx` or `.astro` file, or oxlint walks each one and the program holds both ts-reset rules, the repository tracks no `.ts` or `.tsx` file or the root holds no `tsconfig.json` |
| 1 | oxlint skips a tracked file, a nested oxlint config turns off a rule its entry does not list, `nestedOxlintConfigs` lists a config or a rule it does not need, or the program drops a ts-reset rule |
| 2 | oxlint cannot walk the tree or print a config, a config does not load, `checks.config.ts` does not load or its `nestedOxlintConfigs` key does not decode, or tsc cannot list the program after oxlint walks every tracked file, as when the repository's install lacks either tool or a config does not parse |

## Sample output

```
lint-coverage: oxlint skips 1/3 tracked .ts/.tsx/.astro files; missing:
ignored/b.ts
lint-coverage: packages/app/oxlint.config.ts turns off or down rules the root oxlint config sets:
  off: typescript/no-explicit-any
  down: no-debugger
  set each back in packages/app/oxlint.config.ts, or list it for packages/app/oxlint.config.ts under nestedOxlintConfigs in checks.config.ts
lint-coverage: checks.config.ts nestedOxlintConfigs lets packages/app/oxlint.config.ts turn off max-lines, which it does not turn off or down
lint-coverage: the program tsconfig.json builds drops the ts-reset rules: is-array json-parse
  extend @avi2dg/checks/tsconfig.effect.json, and set files or include in tsconfig.json but not both
```

A passing run counts the files and names the rules:

```
lint-coverage: 71/71 tracked .ts/.tsx/.astro files
lint-coverage: 1 nested oxlint config(s) turn off or down only the rules checks.config.ts nestedOxlintConfigs lists
lint-coverage: the program tsconfig.json builds holds the ts-reset rules is-array and json-parse
```

## When it runs

`checks-lint` runs it in the full run when the repository tracks a `.ts`, `.tsx` or `.astro` file.
A pull request run judges it when the change selects the tree gates.
The desk run judges it too.
`checks-lint --whole-tree` also runs it when someone starts the whole-tree run by hand.

## Related topics

- [checks-lint](checks-lint.md)
- [The Effect rules](../configs/effect-rules.md)
- [The TypeScript rules](../configs/typescript-rules.md)
