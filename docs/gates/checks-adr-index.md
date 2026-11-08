---
kind: reference
audience: consumers
---
# checks-adr-index

`checks-adr-index` writes the index of the records in `docs/adr/` into `docs/adr/README.md`.

## What it checks

It writes one table row per record, with the record's number, title, status and the paths its `governs` lists.
The number links to the record, and the rows run in file name order.
The title drops the number its heading opens with.
The status is the word the record's `## Status` opens with.
The table sits between a `<!-- generated adr-index: ... -->` line and its `<!-- end generated adr-index -->` line.
It rewrites that block and leaves the rest of `docs/adr/README.md` as it is.
A README without the block gets it at its end, and a missing README is written with a title and the block.
A repository with no record in `docs/adr/` gets no index.
[checks-docs](checks-docs.md#the-record-index) fails a range that touches `docs/adr/` and leaves the block stale.

## What it reads

It reads each record in the working tree, tracked or untracked but not ignored, from the repository root.

## Arguments

```sh
checks-adr-index
```

It takes no arguments.

## Exit codes

| Code | Result |
| --- | --- |
| 0 | The index was written, or `docs/adr/` holds no record. |
| 2 | Git or the file system failed. |

## Sample output

```
checks-adr-index: wrote the index of 2 record(s) into docs/adr/README.md
```

## When it runs

Whoever adds or edits a record runs it before committing, or the build of a repository with records runs it.

## Related topics

- [checks-docs](checks-docs.md)
