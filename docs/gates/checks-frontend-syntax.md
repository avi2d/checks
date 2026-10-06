---
kind: reference
audience: consumers
---
# checks-frontend-syntax

`checks-frontend-syntax` is the opt-in gate that refuses two CSS constraints a program can decide: a transition over `all` and a body-wide `user-select`.

## What it checks

It runs stylelint with two of stylelint's own rules, and with no other rule and no repository config:

| Rule | What it refuses | Why |
| --- | --- | --- |
| `declaration-property-value-disallowed-list` | `all` in the value of `transition` or `transition-property`, vendor prefixes included, such as `transition: all 200ms` or `-webkit-transition: opacity 1s, all 1s` | every property that changes then animates, including the ones that make the browser lay out the page again |
| `rule-selector-property-disallowed-list` | `user-select` or a prefixed `user-select` such as `-webkit-user-select` in a rule whose selector list holds `html`, `body`, `:root` or `*` | a visitor cannot select or copy any text on the page |

The second rule refuses any value on those selectors, so `body { user-select: text; }` fails as well.
It matches each item of the selector list as a whole.
So it does not follow `:is()`, `:where()` or `:not()`, nor a compound such as `html body` or `body *`.
A control that needs selection off sets it on its own selector, such as `.drag-handle { user-select: none; }`, which passes.

It judges each `.css` file, and each `<style>` block and `style` attribute in an `.html`, `.astro`, `.vue` or `.svelte` file, through `postcss-html`.
It reports a file that does not parse, since it cannot judge one.
It fails on each declared input that matches no file, so an input that a renamed directory or a skipped build leaves empty never passes.

These are outside what it decides:

- A `transition` shorthand that names no property, such as `transition: 200ms`, which the browser reads as `all`.
- A value it cannot see, such as `transition: var(--motion)` or a style a script sets.
- `user-select: none` in a `style` attribute on `<body>`, which has no selector to judge.
- A viewport that disables zoom, since stylelint reads only CSS.
  A repository that runs only this gate gets no viewport check, and [checks-browser](checks-browser.md) refuses one on the rendered page through axe's `meta-viewport` rule.
- Whether motion respects a visitor who turns it off, which only the rendered page shows, as the `motion` check of [checks-browser](checks-browser.md) says.
  A `prefers-reduced-motion` query in the source proves nothing about what moves.

## What it reads

It reads `frontend-syntax.json` in the directory it runs in, which lists the inputs as globs:

```json
{
  "inputs": ["src/**/*.css", "src/**/*.astro", "dist/**/*.html"]
}
```

A glob over built output, such as `dist/**/*.html`, judges the styles a framework or a CSS tool generates, and needs the build to run first.
stylelint resolves each glob from that directory, skips `node_modules/` and honours `.stylelintignore`.
It reads the working tree, so an uncommitted file is judged like a committed one.

The repository installs the two optional peers the gate loads, at the versions the kit pins:

```sh
bun add -d stylelint@17.16.0 postcss-html@2.0.0
```

## Arguments

```sh
checks-frontend-syntax [<directory>]
```

It checks the directory it runs in, or the directory it is given.

## Exit codes

| Code | When |
| --- | --- |
| 0 | every declared input matches a file, and no file holds a refused declaration |
| 1 | a file holds a refused declaration or does not parse, or a declared input matches no file |
| 2 | `frontend-syntax.json` is missing or does not decode, its input list is empty, or stylelint or `postcss-html` cannot load |

## Sample output

```
frontend-syntax: 3 problem(s) in 2 file(s) from 3 declared input(s):
  dist/**/*.html: the declared input matches no file
  src/layouts/Base.astro:4:15 Disallowed property "user-select" for selector "body". Leave text selectable across the page, and turn selection off only on the control that needs it.
  src/styles/site.css:1:17 Disallowed value "all 200ms" for property "transition". Name the properties the transition animates.
```

A passing run counts what it judged:

```
frontend-syntax: no violation in 2 file(s) from 2 declared input(s)
```

## When it runs

`checks-lint` runs it when the repository tracks `frontend-syntax.json` at its root.
A repository without that file never runs it and needs neither stylelint nor `postcss-html`.

## Related topics

- [checks-browser](checks-browser.md)
- [checks-lint](checks-lint.md)
