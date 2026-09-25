# checks-suppressions-ratchet

`checks-suppressions-ratchet` is the gate that holds oxlint's bulk-suppression baseline to counts that only fall, and a reader looks it up when a change raised a count.

## What it checks

oxlint accepts whatever `oxlint --suppress-all` writes to `oxlint-suppressions.json`, so raising a count to let a new site through passes the lint.
The ratchet fails naming each file and rule whose count rose or that appeared.
A count that fell and an entry that went both pass.

## What it reads

It reads `oxlint-suppressions.json` at a base and at a head, from the directory the command runs in, which is where oxlint writes it.
A commit without the file counts as empty, so the commit that first adds a baseline fails with every entry appearing.

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
| 2 | a ref does not resolve, the parent exists but is not in the clone, or the file is not oxlint's count per rule per file |

## Sample output

```
suppressions-ratchet: 2 count(s) in oxlint-suppressions.json rose or appeared; fix the site instead of suppressing it:
  src/added.ts typescript/no-unsafe-type-assertion appeared with 1
  src/dispatch.ts typescript/no-non-null-assertion rose from 12 to 13
```

## Opting out

It applies to every repository, so no selection leaves it out.
A repository with no `oxlint-suppressions.json` passes, since both ends count as empty.
`checks-lint` runs it over each pull request's range, as [checks-lint](checks-lint.md) says.

## Related topics

- [The Effect rules](../configs/effect-rules.md)
- [checks-lint](checks-lint.md)
