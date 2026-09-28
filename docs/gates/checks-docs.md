---
kind: reference
audience: consumers
---
# checks-docs

`checks-docs` is the gate that holds a repository's doc files to the kit's templates and prose rules.
It also fails when a doc names a file, a heading or a script that does not exist, or a name the range removed from every file outside the docs.

## What it checks

It holds each doc file a change touches to the template for its kind.
It lists every other doc file that does not match its template yet, and does not fail on it.
It holds each line a change adds or edits in a living doc or an agent file to the prose rules, as [The prose rules](#the-prose-rules) says.
It fails when a living doc or an agent file names a path, link or command that does not resolve, and the range added or broke it.
It fails when an agent file holds more than 3,000 characters, whatever the range touches, as [Agent files](#agent-files) says.
It fails when a line the range adds or edits under an agent file topic section names no path, link or command that resolves.
It fails when a living doc or an agent file names a code span the range removed from every file outside the docs, on any line.
[Paths, links and commands](#paths-links-and-commands) says how each reference resolves.
The package ships one template per kind under `dist/templates/`, and a repository starts a new doc file by copying one:

```sh
cp node_modules/@avi2dg/checks/dist/templates/how-to.md docs/add-a-supplier.md
```

A host resolves a template as `@avi2dg/checks/templates/how-to.md`, which keeps pointing at it wherever the package holds the templates.

<!-- generated doc-kinds: bun run build writes it from src/docs/doc-rules.ts, src/docs/doc-templates.ts and scripts/doc-blocks.ts -->

| File | Kind | Template |
| --- | --- | --- |
| `README.md` | readme | `dist/templates/readme.md` |
| `CHANGELOG.md` | changelog | `dist/templates/changelog.md` |
| `AGENTS.md` | agents | `dist/templates/agents.md` |
| `CLAUDE.md` | claude | `dist/templates/claude.md` |
| `CONTRIBUTING.md` | how-to | `dist/templates/how-to.md` |
| each file in `docs/adr/` but its generated index, `README.md` | adr | `dist/templates/adr.md` |
| a page with `kind` in front matter | tutorial, how-to, reference or explanation | `dist/templates/<mode>.md` |

<!-- end generated doc-kinds -->

Each file the table names by name sits at the repository root.
A page under `docs/` declares its mode in front matter:

```yaml
---
kind: tutorial
---
```

No other Markdown file is held to a template.
A template decides a file's structure, and the template file itself is the reference for its kind:

- A file opens with one `# ` title on its first line and has text before its first section.
  It skips no heading level, and no heading is Overview, Introduction or How it works.
- Its sections are the template's headings, in the template's order.
  A heading in angle brackets is one the writer names.
  A heading the template marks verb first is left to review, because no program tells a verb from a noun.
  A heading the template does not have in that place is refused.
- A record in `docs/adr/` is named for its four-digit number, and its title opens with the same number.
  A `Date: YYYY-MM-DD` line follows the title.
  The first word under Status is Proposed, Accepted, Rejected, Deprecated, Superseded or Retired.
  No other record holds its number.
- A changelog lists its releases newest first, and each opens with a `Released YYYY-MM-DD.` line.
- A how-to or tutorial page numbers its steps.
- `CLAUDE.md` is its template word for word.
  It is a fixed pointer to `AGENTS.md` rather than a living doc, so it takes only the prose rules for agent files.

## The prose rules

The prose rules judge each line a change adds or edits in a living doc or an agent file.
A line the change leaves alone is not judged, so a repository needs no cleanup pass before it runs them.

<!-- generated living-docs: bun run build writes it from src/docs/prose-matchers.ts and scripts/doc-blocks.ts -->

A living doc is one of these:

- a `README.md` or `CONTRIBUTING.md` in any directory
- a Markdown page under `docs/`

An agent file is a `AGENTS.md` or `CLAUDE.md` in any directory, and takes only the rules the table below marks for agent files.

These are records, and take no prose rule:

- a file in `docs/adr/`
- a file whose name opens with four digits, as in `0001-` or `2026-05-08-`
- a `CHANGELOG.md`

<!-- end generated living-docs -->

<!-- generated prose-rules: bun run build writes it from PROSE_RULES in src/docs/prose-matchers.ts and scripts/doc-blocks.ts -->

| Refused | For example | Write instead | In agent files |
| --- | --- | --- | --- |
| an em dash | `—` | End the sentence, or use a comma | yes |
| an en dash | `–` | End the sentence, or use a comma | yes |
| a parenthesis other than the plural `(s)` | `(` | Make the aside its own sentence, or set it off with commas | yes |
| a hyphen used as a dash | `a - b` or `a -- b` | End the sentence, or use a comma | yes |
| a semicolon | `;` | Use two sentences | yes |
| a promise about the future | `until #11`, `is planned`, `will soon`, `coming soon`, `in a future release` | Say what is true now | no |
| a report about the past | `formerly`, `previously`, `as before`, `used to`, `was replaced`, `moved from`, `new owner` | Say what is true now, and leave what changed to the changelog, a commit message or a decision record | yes |
| a sentence that opens by talking about the page | `This page explains` | Talk directly about the subject | no |
| a second sentence on one line | `It builds. It ships.` | Start it on its own line | no |
| a sentence that runs across lines | `It builds` with `and ships.` on the next line | Join the sentence onto one line | no |

<!-- end generated prose-rules -->

A line holds one sentence, so a changed line is a changed sentence.
A bold label that opens a line, as in `**Status.**`, heads the sentence after it and is not a sentence of its own.
No rule reads fenced code, inline code, link destinations, URLs, HTML comments or front matter.
Readability scores and word choice, such as easy, are not checked.

`src/docs/prose-matchers.ts` holds the rules and a synchronous `proseRefused()`, and imports nothing.
The package exports it as `@avi2dg/checks/scripts/prose-matchers.ts`.
A host such as a write-time hook can copy that one file into a directory with no `node_modules`, and refuse the same lines.

## Paths, links and commands

Each reference a living doc or an agent file names has to resolve at the head commit:

- A path in inline code that ends in a file extension, such as `src/core/lint.ts`, names a file from the root or from the doc's directory.
- A relative Markdown link names a file or a directory.
  Its anchor names a heading in that file, as GitHub derives the anchor, or an explicit `id`.
- A `bun run` command in code names a script in the nearest `package.json`, a bin in `node_modules/.bin`, or a file that exists.
- A code span fails when some tracked file outside the docs held that exact text at the base, and none holds it at the head.
  A span the path check already fails on is not reported again.
  A name an installed direct dependency still holds counts as present.
  A span with a space, a placeholder or a leading dash names a command or a flag, and is skipped.
  A span that opens with the repository's own package name and a slash, `node_modules/`, `./` or `~/` reads as the file it names.

A reference that does not resolve fails when it sits on a line the range adds or edits.
On any other line, it fails when the range broke it, for example by deleting the file it names or renaming the heading it links.
A reference that was broken before the range is listed as advisory.
A path whose top directory the repository lacks at both ends of the range names another repository's file, such as a consumer's, and is skipped.
A path git ignores is skipped too, because a clean checkout lacks a generated file by design.

A page that speaks to a consuming repository sets `audience: consumers` in its front matter.
No `bun run` command on such a page is looked up in a `package.json`:

```yaml
---
kind: reference
audience: consumers
---
```

## Agent files

An agent file holds the router its template sketches, and the two rules below hold its shape.
A file over 3,000 characters fails whatever the range touches.
Move each part's notes into the people doc that covers that part, and delete what a check or the code already holds.
Each list item under a topic section names a path in inline code, a Markdown link or a `bun run` command, and the item fails when the range adds or edits it with none.
A topic section is any `## ` section but `## Maintaining this file`, and each reference resolves as [Paths, links and commands](#paths-links-and-commands) says.
A fresh file passes the ceiling, and its entries pass once each names the file that holds its detail.

## What it reads

It reads each Markdown file at the head commit, and uses its path or front matter to choose its kind.
A file the range adds, changes or renames is held to its template, and a file it deletes is not.
It reads the lines the range adds or edits from the diff, with renames detected, so a renamed doc is judged only on the lines the rename changed.
It reads the files tracked at both ends of the range, and the `scripts` of each `package.json` a living doc or an agent file sits under.
It compares each code span a living doc or an agent file names with the text git tracks outside the docs at both ends of the range.
It reads the repository's own name and its direct dependencies from the root `package.json` at the head commit.
It reads each agent file at the head commit for the ceiling, whatever the range touches.
A name that an installed direct dependency still holds counts as present.
From the working tree it reads the ignore files git reads, `node_modules/.bin`, and the directory of each direct dependency under `node_modules`.

## Arguments

```sh
checks-docs <base-ref> <head-ref>
checks-docs <ref>
```

With two arguments the range starts where the head branched from the base, at their merge-base.
With one it is that commit against its parent, or against the empty tree for a repository's first commit.

## Exit codes

| Code | When |
| --- | --- |
| 0 | every doc file the range touches holds to its template, every line it adds to a living doc or an agent file holds to the prose rules, it adds or breaks no reference that does not resolve, every agent file holds to the ceiling, every entry the range adds or edits names a path, link or command, and no code span a living doc or an agent file names vanished from every file outside the docs |
| 1 | a doc file the range touches does not hold to its template, a line the range adds to a living doc or an agent file breaks a prose rule, the range adds or breaks a reference that does not resolve, an agent file is over the ceiling, an entry the range adds or edits names no path, link or command, or the range removes a name a living doc or an agent file still carries |
| 2 | a `package.json` does not decode, a ref does not resolve, or `grep` cannot read an installed direct dependency |

## Sample output

```
docs: 6 violation(s):
  README.md:1: lacks `## Where things are`
  README.md:12: carries `;`, a semicolon. Use two sentences
  README.md:14: carries `former`, a report about the past. Say what is true now, and leave what changed to the changelog, a commit message or a decision record
  README.md:20: names `scripts/bild.ts`, which is not in the repository
  docs/parts.md: is a page under docs/ with no mode; add kind: tutorial, how-to, reference, explanation in YAML front matter
  docs/parts.md:9: names `gates.lint`, which the range removed from every file outside the docs. Say what holds now, or drop the line
docs: advisory, 1 doc file(s) the range leaves alone do not hold to their templates yet:
  docs/adr/0001-quality-gates.md: 5 violation(s)
docs: advisory, 1 path(s), link(s) or command(s) the living docs or agent files name were broken before the range:
  docs/parts.md:9: links to `suppliers.md#prices`, and `docs/suppliers.md` has no heading with that anchor
```

## When it runs

`checks-lint` runs it over each pull request's range in every repository, as [checks-lint](checks-lint.md) says.
A repository adopts the templates as its files change, and the prose rules as its lines change, because an untouched file or line never fails those checks.
A name the range removes fails wherever a doc still carries it, because the removal is what turned the line stale.

## Related topics

- [Why it is shaped this way](../design.md)
- [checks-lint](checks-lint.md)
