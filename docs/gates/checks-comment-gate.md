# checks-comment-gate

`checks-comment-gate` is the gate that refuses a banned comment on a line a change adds, and a reader looks it up to learn which comments it refuses.

## What it checks

It fails when an added line carries a banned comment.
It refuses a machine-read directive, a record or ticket pointer, a doc block, and a file opening with a rationale block over three lines, licence headers excepted.
Each refusal says what to write instead.
Only added lines are checked, so a violation in a file the diff never touches stays silent.
A refusal counts when any line of the comment carrying it was added.

## What it reads

It reads the diff between two commits, and the added lines of each file whose extension has a comment syntax in `scripts/comment-matchers.ts`.
It passes over a file with any other extension.

`scripts/comment-matchers.ts` holds the scanner, the comment syntaxes and a synchronous `refused()`, and imports nothing.
A host such as a hook bundle can therefore copy it alone into a directory with no `node_modules` and import it as `@avi2dg/checks/scripts/comment-matchers.ts`.
The kit's own dependency cruise fails when that file gains an import.
`scripts/comments.ts` wraps the same matchers in Effect for the gate and for [checks-backtest](checks-backtest.md).

## Arguments

```sh
checks-comment-gate <base-ref> <head-ref>
checks-comment-gate <ref>
```

With two arguments it diffs the base against the head.
With one it diffs that commit against its parent, or against the empty tree for a repository's first commit, which has none.
A shallow checkout running the one-argument form needs `fetch-depth: 2`.

## Exit codes

| Code | When |
| --- | --- |
| 0 | no added line carries a refused comment |
| 1 | an added line carries a refused comment |
| 2 | a ref does not resolve, or the parent exists but is not in the clone, which it refuses rather than widening to the whole tree |

## Sample output

```
comment-gate: 2 violation(s):
  src/a.ts:1 points at a record or a ticket ("#41"). Drop the pointer: a record is reached by searching docs/adr, and the story of the change goes in the commit message
  src/a.ts:2 carries the machine-read directive `eslint-disable-next-line`. Fix what the tool is reporting, or stop running the tool on this file
```

## Opting out

It applies to every repository, so no selection leaves it out.
`checks-lint` runs it over each pull request's range, as [checks-lint](checks-lint.md) says.

## Related topics

- [checks-backtest](checks-backtest.md)
- [checks-lint](checks-lint.md)
