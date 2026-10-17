---
kind: reference
audience: consumers
---
# checks-copy

`checks-copy` is the opt-in gate that refuses an em dash, an en dash or a hyphen used as a dash in copy a person reads.

## What it checks

It judges every line of each Markdown and HTML file a repository declares as its copy, in any language.
It holds them to the three separator rules of [The prose rules](checks-docs.md#the-prose-rules):

| Refused | For example | Passes |
| --- | --- | --- |
| an em dash | `hexn.io — платформа` | `hexn.io, платформа` |
| an en dash | `pages 1–5` | `pages 1 to 5` |
| a hyphen used as a dash | `hexn.io - платформа` or `a -- b` | `well-known`, `kebab-case`, `1-5` and `--flag` |

A hyphen used as a dash is a run of one to three hyphens with white space on both sides and text on both sides.
So a hyphen inside a word or a number, a flag and a list marker all pass.
It reads text as a reader sees it, so a line break, a non-breaking space or a run of spaces counts as one space.
A hyphen that ends one line of a paragraph and is followed by a word on the next still reads as spaced.
Copy in a table passes a hyphen standing alone in a cell.

In a Markdown file it reads what [checks-docs](checks-docs.md) reads, with the same scanner.
It skips fenced code, inline code, link destinations, URLs, HTML comments and front matter, and keeps the text of a link.
Each paragraph and each list item is read whole across its lines, while a heading and a table row are each read on their own.

In an HTML file it reads the page through html-validate, with one rule of the kit's own named `copy/separators`.
It reads the text of the page, with `<title>` included, and each `alt`, `title`, `placeholder`, `aria-label` and `aria-description` attribute.
It reads the `content` of a `<meta>` whose `name` or `property` is `description`, `og:title`, `og:description`, `twitter:title` or `twitter:description`.
It decodes a numeric character reference and `&mdash;`, `&ndash;` and `&nbsp;`, so `a &mdash; b` fails as an em dash.
Text runs across an inline element such as `<a>` or `<strong>`, as `<a href="https://example.com">Example</a> - about` shows, and breaks at a block such as `<p>` or `<li>` and at `<br>`.
Each of `<code>`, `<kbd>`, `<samp>` and `<var>` stands in as one character the rules never refuse, so a hyphen used as a dash after it still fails.
It does not read `<script>`, `<style>`, `<template>`, `<noscript>`, `<pre>`, `<textarea>`, `<svg>` or `<math>`.
It reports a file that does not parse as HTML, since it cannot judge one.
It fails on each declared input that matches no Markdown or HTML file.
So an input that a renamed directory or a skipped build leaves empty never passes.
It also fails on each file an input matches that is neither Markdown nor HTML.

These are outside what it decides:

- A string in TypeScript source, since no program tells copy from code in a string.
  A site's UI strings reach its built pages, so a glob over the built HTML judges them.
- What CSS hides or a script changes, since it reads the HTML source rather than a rendered page.
- A dash in front matter, such as a page title, which a glob over the built HTML judges on the page.
- Parentheses, semicolons and the other prose rules, which judge only the docs [checks-docs](checks-docs.md) holds.

## What it reads

It reads `copy.json` in the directory it runs in, which lists the inputs as globs:

```json
{
  "inputs": ["src/content/**/*.md", "dist/**/*.html"]
}
```

A glob over built output, such as `dist/**/*.html`, judges every string a site renders, and needs the build to run first.
Each glob resolves from that directory, matches only files and skips `node_modules/`.
It reads each file ending in `.md` or `.html` that a glob matches, and a file two globs match is judged once.
It reads the working tree, so an uncommitted file is judged like a committed one.

A repository that declares an HTML file installs the optional peer the gate loads for it, at the version the kit pins:

```sh
bun add -d html-validate@11.16.0
```

## Arguments

```sh
checks-copy [<directory>]
```

It checks the directory it runs in, or the directory it is given.

## Exit codes

| Code | When |
| --- | --- |
| 0 | every declared input matches a Markdown or HTML file, and no file carries a refused separator |
| 1 | a file carries a refused separator or does not parse, a declared input matches no Markdown or HTML file, or an input matches a file of another kind |
| 2 | `copy.json` is missing or does not decode, its input list is empty, or html-validate cannot load |

## Sample output

```
copy: 3 problem(s) in 2 file(s) from 3 declared input(s):
  public/**/*.html: the declared input matches no Markdown or HTML file
  dist/index.html:102:57 carries `-`, a hyphen used as a dash. End the sentence, or use a comma
  src/content/home.ru.md:26:33 carries `-`, a hyphen used as a dash. End the sentence, or use a comma
```

A passing run counts what it judged:

```
copy: no violation in 2 file(s) from 2 declared input(s)
```

## When it runs

`checks-lint` runs it when the repository tracks `copy.json` at its root.
A repository without that file never runs it and needs no html-validate.

## Related topics

- [checks-docs](checks-docs.md)
- [checks-browser](checks-browser.md)
- [checks-lint](checks-lint.md)
