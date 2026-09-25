# checks-lint-coverage

`checks-lint-coverage` is the gate that fails when oxlint silently skips a tracked TypeScript file, and a reader looks it up when a file seems never to be linted.

## What it checks

It fails when oxlint skips a tracked `.ts` or `.tsx` file, for example through a stray `.gitignore` entry.
It compares `git ls-files` against oxlint's own file walk and names the missing files.

## What it reads

It reads the working tree: the `*.ts` and `*.tsx` files `git ls-files` lists, and the files `oxlint --debug=files` walks.
It walks without naming a path, since an explicit path bypasses the ignore files whose skips it looks for.
oxlint must be on `PATH`, as it is under a package script.

## Arguments

It takes none.

## Exit codes

| Code | When |
| --- | --- |
| 0 | oxlint walks every tracked `.ts` and `.tsx` file, or the repository tracks none |
| 1 | oxlint skips a tracked file |
| 2 | oxlint cannot walk the tree, as when it is not on `PATH` or its config does not parse |

## Sample output

```
lint-coverage: oxlint skips 1/3 tracked .ts/.tsx files; missing:
ignored/b.ts
```

A passing run counts the files:

```
lint-coverage: 71/71 tracked .ts/.tsx files
```

## Opting out

A repository that tracks no `.ts` or `.tsx` file leaves it out of `gates.lint`, as [Gate selection](checks-lint.md#gate-selection) says.
A repository that tracks one keeps it.

## Related topics

- [checks-lint](checks-lint.md)
- [The Effect rules](../configs/effect-rules.md)
