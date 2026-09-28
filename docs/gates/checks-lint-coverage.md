---
kind: reference
audience: consumers
---
# checks-lint-coverage

`checks-lint-coverage` is the gate that fails when oxlint skips a tracked TypeScript file, or when the program `tsconfig.json` builds drops the ts-reset rules, without saying so.

## What it checks

It fails when oxlint skips a tracked `.ts`, `.tsx` or `.astro` file, for example through a stray `.gitignore` entry.
It compares `git ls-files` against oxlint's own file walk and names the missing files.
It lists each tracked `.astro` file the same way, since oxlint lints `.astro` frontmatter.

It fails when the program `tsconfig.json` builds leaves out the `is-array` or the `json-parse` rule of `@total-typescript/ts-reset`, which `tsconfig.effect.json` lists.
A `tsconfig.json` that does not extend `@avi2dg/checks/tsconfig.effect.json`, or that sets both `files` and `include`, leaves both rules out.
[The TypeScript rules](../configs/typescript-rules.md) says what the two rules refuse.

## What it reads

It reads the working tree: the `*.ts`, `*.tsx` and `*.astro` files `git ls-files` lists, and the files `oxlint --debug=files` walks.
It walks without naming a path, since an explicit path bypasses the ignore files whose skips it looks for.
It reads the program from `tsc --listFilesOnly -p tsconfig.json`, and passes over the program when the root holds no `tsconfig.json`.
oxlint and tsc must be on `PATH`, as they are under a package script.

## Arguments

It takes none.

## Exit codes

| Code | When |
| --- | --- |
| 0 | the repository tracks no `.ts`, `.tsx` or `.astro` file, or oxlint walks each one and the program holds both ts-reset rules or the root holds no `tsconfig.json` |
| 1 | oxlint skips a tracked file, or the program drops a ts-reset rule |
| 2 | oxlint cannot walk the tree, or tsc cannot list the program after oxlint walks every tracked file, as when either is not on `PATH` or a config does not parse |

## Sample output

```
lint-coverage: oxlint skips 1/3 tracked .ts/.tsx/.astro files; missing:
ignored/b.ts
lint-coverage: the program tsconfig.json builds drops the ts-reset rules: is-array json-parse
  extend @avi2dg/checks/tsconfig.effect.json, and set files or include in tsconfig.json but not both
```

A passing run counts the files and names the rules:

```
lint-coverage: 71/71 tracked .ts/.tsx/.astro files
lint-coverage: the program tsconfig.json builds holds the ts-reset rules is-array and json-parse
```

## When it runs

`checks-lint` runs it when the repository tracks a `.ts`, `.tsx` or `.astro` file.

## Related topics

- [checks-lint](checks-lint.md)
- [The Effect rules](../configs/effect-rules.md)
- [The TypeScript rules](../configs/typescript-rules.md)
