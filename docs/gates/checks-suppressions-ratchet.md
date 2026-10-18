---
kind: reference
audience: consumers
---
# checks-suppressions-ratchet

`checks-suppressions-ratchet` is the gate that fails when a change raises a count in `oxlint-suppressions.json` or `stylelint-suppressions.json`.

## What it checks

oxlint accepts whatever `oxlint --suppress-all` writes to `oxlint-suppressions.json`, so raising a count to let a new site through passes the lint.
stylelint accepts `stylelint-suppressions.json` the same way, and writes it in the same shape, a count per rule per file.
The ratchet fails naming the suppressions file, the file and the rule of each count that rose or appeared.
A count that fell and an entry that went both pass.

## What it reads

It reads `oxlint-suppressions.json` and `stylelint-suppressions.json` at a base and at a head, from the directory the command runs in, which is where oxlint and stylelint write them.
A commit without a file counts it as empty, so the commit that first adds a baseline fails with every entry appearing.

## Arguments

```sh
checks-suppressions-ratchet <base-ref> <head-ref>
checks-suppressions-ratchet <ref>
```

With two arguments it reads the base where the head branched off, at their merge-base, so a count the base branch lowered since does not read as a rise at the head.
With one it compares that commit with its parent, or with the empty tree for a repository's first commit.

## Exit codes

| Code | When |
| --- | --- |
| 0 | no count rose and no entry appeared |
| 1 | a count rose or an entry appeared |
| 2 | a ref does not resolve, the parent exists but is not in the clone, or a file is not a count per rule per file |

## Sample output

```
suppressions-ratchet: 2 count(s) rose or appeared; fix the site instead of suppressing it:
  oxlint-suppressions.json src/dispatch.ts typescript/no-non-null-assertion rose from 12 to 13
  stylelint-suppressions.json src/styles.css selector-max-specificity appeared with 1
```

## When it runs

`checks-lint` runs it over each pull request's range in every repository, as [checks-lint](checks-lint.md) says.
A repository with neither file passes, since both ends count as empty.

## Related topics

- [The Effect rules](../configs/effect-rules.md)
- [checks-frontend-syntax](checks-frontend-syntax.md)
- [checks-lint](checks-lint.md)
