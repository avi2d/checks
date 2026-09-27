---
kind: reference
audience: consumers
---
# checks-docs

`checks-docs` is the gate that holds each doc file a change touches to the template for its kind, each line a change adds to a living doc or an agent file to the prose rules, and each path, link and command a living doc names to what the repository holds, and a reader looks it up to learn what a doc file answers to.

## What it checks

It holds each doc file a change touches to the template for its kind, and lists every other doc file that does not conform yet without failing.
It holds each line a change adds or edits in a living doc or an agent file to the prose rules, as [The prose rules](#the-prose-rules) says.
It fails when a living doc names a path, link or command that does not resolve, and the range added it or broke it, as [Paths, links and commands](#paths-links-and-commands) says.
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

A file the table names on its own, such as `README.md`, sits at the repository root.
No other Markdown file is judged, save a page under `docs/`, which needs a mode.
A page under `docs/` declares its mode in front matter:

```yaml
---
kind: tutorial
---
```

A template decides a file's structure, and the template file itself is the reference for each kind:

- A file opens with one `# ` title on its first line and has text before its first section.
  It skips no heading level, and no heading is Overview, Introduction or How it works.
- Its sections are the template's headings in the template's order.
  A heading in angle brackets is one the writer names.
  One marked verb first is left to review, since no program tells a verb from a noun there.
  A heading the template does not have, in that place, is refused.
- A record in `docs/adr/` is named for its four-digit number, and its title opens with the same number.
  A `Date: YYYY-MM-DD` line follows the title, the first word under Status is Proposed, Accepted, Rejected, Deprecated, Superseded or Retired, and no other record holds its number.
- A changelog lists its releases newest first, each opening with a `Released YYYY-MM-DD.` line.
- A how-to or tutorial page numbers its steps.
- `CLAUDE.md` is its template word for word.
  It is a fixed agent pointer rather than a living doc, so it takes only the prose rules for agent files.

## The prose rules

A line a change adds or edits in a living doc or an agent file is held to the prose rules, and a line the change leaves alone is not, so a repository needs no cleanup pass before it runs them.

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
| a sentence that opens by talking about the page | `This page explains` | Talk directly about the subject | no |
| a second sentence on one line | `It builds. It ships.` | Start it on its own line | no |
| a sentence that runs across lines | `It builds` with `and ships.` on the next line | Join the sentence onto one line | no |

<!-- end generated prose-rules -->

A line holds one sentence, so a changed line is a changed sentence.
A bold label that opens a line, as in `**Status.**`, heads the sentence after it rather than counting as one.
Fenced code, inline code, link destinations, URLs, HTML comments and front matter are not prose, so no rule reads them.
Readability scores and word choice, such as easy, are not checked.

`src/docs/prose-matchers.ts` holds the rules and a synchronous `proseRefused()`, and imports nothing.
A host such as a hook bundle can therefore copy it alone into a directory with no `node_modules` and import it as `@avi2dg/checks/scripts/prose-matchers.ts`, to refuse the same lines at write time.

## Paths, links and commands

Each reference a living doc names has to resolve at the head commit:

- A path in inline code that ends in a file extension, such as `src/core/lint.ts`, names a file from the root or from the doc's directory.
- A relative Markdown link names a file or a directory, and its anchor names a heading in the file it links, as GitHub derives the anchor, or an explicit `id`.
- A `bun run` command in code names a script in the nearest `package.json`, a bin in `node_modules/.bin`, or a file that exists.

A reference that does not resolve fails when it sits on a line the range adds or edits.
It fails on any other line when the range broke it, as by deleting the file it names or renaming the heading it links, and is listed as advisory when it was broken before the range.
A path under a top directory the repository lacks at both ends of the range names another repository's file, such as a consumer's, and is passed over.
So is a path git ignores, since a clean checkout lacks a generated file by design.

A living doc that speaks to a consuming repository sets `audience: consumers` in its front matter, so no `bun run` command it names is held to a `package.json`:

```yaml
---
kind: reference
audience: consumers
---
```

## What it reads

It reads each Markdown file from the head commit and uses its path or front matter to choose a mode.
A file the range adds, changes or renames is held to its template, and a file it deletes is not.
It reads the lines the range adds or edits from the diff, with renames detected, so a renamed doc is judged only on the lines the rename changed.
It reads the files tracked at both ends of the range and the `scripts` of each `package.json` a living doc sits under.
From the working tree it reads the ignore files git reads, and `node_modules/.bin`.

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
| 0 | every doc file the range touches holds to its template, every line it adds to a living doc or an agent file holds to the prose rules, and it adds or breaks no reference that does not resolve |
| 1 | a doc file the range touches does not hold to its template, a line the range adds to a living doc or an agent file breaks a prose rule, or the range adds or breaks a reference that does not resolve |
| 2 | a `package.json` does not decode, or a ref does not resolve |

## Sample output

```
docs: 4 violation(s):
  README.md:1: lacks `## Where things are`
  README.md:12: carries `;`, a semicolon. Use two sentences
  README.md:20: names `scripts/bild.ts`, which is not in the repository
  docs/parts.md: is a page under docs/ with no mode; add kind: tutorial, how-to, reference, explanation in YAML front matter
docs: advisory, 1 doc file(s) the range leaves alone do not hold to their templates yet:
  docs/adr/0001-quality-gates.md: 5 violation(s)
docs: advisory, 1 path(s), link(s) or command(s) the living docs name were broken before the range:
  docs/parts.md:9: links to `suppliers.md#prices`, and `docs/suppliers.md` has no heading with that anchor
```

## Opting out

It applies to every repository, so no selection leaves it out.
A file the range leaves alone is only listed as advisory, so a repository adopts the templates as its files change.
A line the range leaves alone takes no prose rule, so a repository adopts the prose rules as its lines change.
A living doc with `audience: consumers` in its front matter holds no `bun run` command to a `package.json`.
`checks-lint` runs it over each pull request's range, as [checks-lint](checks-lint.md) says.

## Related topics

- [Why it is shaped this way](../design.md)
- [checks-lint](checks-lint.md)
