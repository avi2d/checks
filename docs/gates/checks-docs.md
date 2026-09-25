# checks-docs

`checks-docs` is the gate that holds each doc file a change touches to the template for its kind, and each line a change adds to a living doc to the prose rules, and a reader looks it up to learn what a doc file answers to.

## What it checks

It holds each doc file a change touches to the template for its kind, and lists every other doc file that does not conform yet without failing.
It holds each line a change adds or edits in a living doc to the prose rules, as The prose rules below says.
The package ships one template per kind under `templates/`, and a repository starts a new doc file by copying one:

```sh
cp node_modules/@avi2dg/checks/templates/how-to.md docs/add-a-supplier.md
```

<!-- generated doc-kinds: bun run build writes it from scripts/doc-rules.ts, scripts/quality-file.ts, scripts/doc-templates.ts and scripts/doc-blocks.ts -->

| File | Kind | Template |
| --- | --- | --- |
| `README.md` | readme | `templates/readme.md` |
| `CHANGELOG.md` | changelog | `templates/changelog.md` |
| `AGENTS.md` | agents | `templates/agents.md` |
| `CLAUDE.md` | claude | `templates/claude.md` |
| `CONTRIBUTING.md` | how-to | `templates/how-to.md` |
| each file in `docs/adr/` but its generated index, `README.md` | adr | `templates/adr.md` |
| a page `docs.pages` declares | tutorial, how-to, reference or explanation | `templates/<mode>.md` |

<!-- end generated doc-kinds -->

A file the table names on its own, such as `README.md`, sits at the repository root.
No other Markdown file is judged, save a page under `docs/`, which needs a mode.
Which Diátaxis mode a page is written in is a judgment, so `quality.json` declares it:

```json
"docs": {
  "pages": {
    "reference": ["docs/gates/*.md"],
    "explanation": ["docs/design.md"]
  }
}
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
  It is a fixed agent pointer rather than a living doc, so the prose rules do not apply to it.

## The prose rules

A line a change adds or edits in a living doc is held to the prose rules, and a line the change leaves alone is not, so a repository needs no cleanup pass before it runs them.

<!-- generated living-docs: bun run build writes it from scripts/prose-matchers.ts and scripts/doc-blocks.ts -->

A living doc is one of these:

- a `README.md` or `CONTRIBUTING.md` in any directory
- a Markdown page under `docs/`

These are records or agent files, and never living docs:

- a file in `docs/adr/`
- a file whose name opens with four digits, as in `0001-` or `2026-05-08-`
- a `CHANGELOG.md`, `AGENTS.md` or `CLAUDE.md`

<!-- end generated living-docs -->

<!-- generated prose-rules: bun run build writes it from PROSE_RULES in scripts/prose-matchers.ts and scripts/doc-blocks.ts -->

| Refused | For example | Write instead |
| --- | --- | --- |
| an em dash | `—` | End the sentence, or use a comma |
| an en dash | `–` | End the sentence, or use a comma |
| a parenthesis other than the plural `(s)` | `(` | Make the aside its own sentence, or set it off with commas |
| a hyphen used as a dash | `a - b` or `a -- b` | End the sentence, or use a comma |
| a semicolon | `;` | Use two sentences |
| a promise about the future | `until #11`, `is planned`, `will soon`, `coming soon`, `in a future release` | Say what is true now |
| a sentence that opens by talking about the page | `This page explains` | Talk directly about the subject |
| a second sentence on one line | `It builds. It ships.` | Start it on its own line |
| a sentence that runs across lines | `It builds` with `and ships.` on the next line | Join the sentence onto one line |

<!-- end generated prose-rules -->

A line holds one sentence, so a changed line is a changed sentence.
Fenced code, inline code, link destinations, URLs, HTML comments and front matter are not prose, so no rule reads them.
Readability scores and word choice, such as easy, are not checked.

`scripts/prose-matchers.ts` holds the rules and a synchronous `proseRefused()`, and imports nothing.
A host such as a hook bundle can therefore copy it alone into a directory with no `node_modules` and import it as `@avi2dg/checks/scripts/prose-matchers.ts`, to refuse the same lines at write time.

## What it reads

It reads each Markdown file from the head commit, and `docs.pages` from `quality.json`.
A file the range adds, changes or renames is held to its template, and a file it deletes is not.
It reads the lines the range adds or edits from the diff, with renames detected, so a renamed doc is judged only on the lines the rename changed.

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
| 0 | every doc file the range touches holds to its template |
| 1 | a doc file the range touches does not hold to its template, or a line the range adds to a living doc breaks a prose rule |
| 2 | `quality.json` does not decode, or a ref does not resolve |

## Sample output

```
docs: 3 violation(s) in the doc files the range touches:
  README.md:1: lacks `## Where things are`
  README.md:12: carries `;`, a semicolon. Use two sentences
  docs/parts.md: is a page under docs/ with no mode; declare it under docs.pages in quality.json as tutorial, how-to, reference, explanation
docs: advisory, 1 doc file(s) the range leaves alone do not hold to their templates yet:
  docs/adr/0001-quality-gates.md: 5 violation(s)
```

## Opting out

It applies to every repository, so no selection leaves it out.
A file the range leaves alone is only listed as advisory, so a repository adopts the templates as its files change.
A line the range leaves alone takes no prose rule, so a repository adopts the prose rules as its lines change.
`checks-lint` runs it over each pull request's range, as [checks-lint](checks-lint.md) says.

## Related topics

- [Why it is shaped this way](../design.md)
- [checks-lint](checks-lint.md)
