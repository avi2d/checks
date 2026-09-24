# checks-docs

`checks-docs` is the gate that holds each doc file a change touches to the template for its kind, and a reader looks it up to learn which template a file answers to.

## What it checks

It holds each doc file a change touches to the template for its kind, and lists every other doc file that does not conform yet without failing.
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
  It is a fixed agent pointer rather than a people doc, so the separator ban does not apply to it: people docs take no em dash, en dash, parenthesis or hyphen used as a dash, and no semicolon, and `checks-docs` does not check separators.

## What it reads

It reads each Markdown file from the head commit, and `docs.pages` from `quality.json`.
A file the range adds, changes or renames is held to its template, and a file it deletes is not.

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
| 1 | a doc file the range touches does not |
| 2 | `quality.json` does not decode, or a ref does not resolve |

## Sample output

```
docs: 2 violation(s) in the doc files the range touches:
  README.md:1: lacks `## Where things are`
  docs/parts.md: is a page under docs/ with no mode; declare it under docs.pages in quality.json as tutorial, how-to, reference, explanation
docs: advisory, 1 doc file(s) the range leaves alone do not hold to their templates yet:
  docs/adr/0001-quality-gates.md: 5 violation(s)
```

## Opting out

It applies to every repository, so no selection leaves it out.
A file the range leaves alone is only listed as advisory, so a repository adopts the templates as its files change.
`checks-lint` runs it over each pull request's range, as [checks-lint](checks-lint.md) says.

## Related topics

- [Why it is shaped this way](../design.md)
- [checks-lint](checks-lint.md)
