---
kind: reference
audience: consumers
---
# checks-comment-gate

`checks-comment-gate` is the gate that refuses a banned comment on a line a change adds.

## What it checks

It fails when an added line carries a banned comment.
It refuses a machine-read directive, a record or ticket pointer, a doc block, and a file opening with a rationale block over three lines, licence headers excepted.
The directives include `@ts-expect-error`, `@ts-ignore`, `@ts-nocheck`, `biome-ignore`, and `prettier-ignore`.
They also include directives beginning with `eslint-disable`, `jscpd:ignore`, `oxlint-disable`, or `stylelint-disable`.
For a `jscpd:ignore` directive, the refusal says to remove the repeat instead.
A tracker key is a ticket pointer only when its prefix appears in `trackerKeyPrefixes` in `checks.config.ts`.
A stylesheet keeps its count of existing stylelint problems in `stylelint-suppressions.json` instead, as [checks-frontend-syntax](checks-frontend-syntax.md) says.
Each refusal says what to write instead.
Only added lines are checked, so a violation in a file the diff never touches stays silent.
A refusal counts when any line of the comment carrying it was added.

## Tracker keys

Set `trackerKeyPrefixes` in `checks.config.ts` to the tracker prefixes your repository uses:

```ts
import { defineConfig } from "@avi2dg/checks/config";

export default defineConfig({ trackerKeyPrefixes: ["ABC"] });
```

Each prefix starts with an uppercase ASCII letter and contains only uppercase ASCII letters and digits.
Matching is case-sensitive and requires a hyphen followed by digits, such as `ABC-123`.
The default is `[]`, so no tracker key is refused unless you declare its prefix.
An undeclared prefix stays allowed, including standards names such as `IEEE-754`, `CRC-32`, and `SHA-3`.
Record paths, ADR numbers, issue numbers, and issue or pull request URLs remain refused without this setting.
A comment produces one record-pointer refusal even when a configured tracker prefix also matches an ADR number.

## What it reads

It reads the diff between two commits, and the added lines of each file whose extension has a comment syntax in `src/quality/comment-matchers.ts`.
It passes over a file with any other extension.
It reads `trackerKeyPrefixes` from the working tree's `checks.config.ts`.
A host using the synchronous `refused(path, source, within, trackerKeyPrefixes)` supplies the prefixes itself.
The optional fourth argument defaults to `[]`.

`src/quality/comment-matchers.ts` holds the scanner, the comment syntaxes and a synchronous `refused()`, and imports nothing.
A host such as a hook bundle can therefore copy it alone into a directory with no `node_modules` and import it as `@avi2dg/checks/scripts/comment-matchers.ts`.
The kit's own dependency cruise fails when that file gains an import.
`REFUSED_DIRECTIVES` in that file owns the refused directive names, and the checker builds its directive pattern from that list, so the two cannot disagree.
A consumer reads the same contract by importing `REFUSED_DIRECTIVES` from `@avi2dg/checks/scripts/comment-matchers.ts`.
`src/quality/comments.ts` wraps the same matchers in Effect for the gate.

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
| 2 | the config does not load or decode, a ref does not resolve, or the parent exists but is not in the clone |

## Sample output

```
comment-gate: 2 violation(s):
  src/a.ts:1 points at a record or a ticket ("#41"). Drop the pointer: a record is reached by searching docs/adr, and the story of the change goes in the commit message
  src/a.ts:2 carries the machine-read directive `eslint-disable-next-line`. Fix what the tool is reporting, or stop running the tool on this file
```

## When it runs

`checks-lint` runs it over each pull request's range in every repository, as [checks-lint](checks-lint.md) says.

## Related topics

- [checks-lint](checks-lint.md)
