---
kind: reference
audience: consumers
---
# checks-frontend-syntax

`checks-frontend-syntax` is the opt-in gate that holds a repository's CSS to stylelint, under the kit's two rules of its own and the rule families of `@avi2dg/checks/stylelint`.

## What it checks

It runs stylelint twice over each declared input.
The repository run holds the families the repository's `stylelint.config.ts` sets, and applies `--fix`.
The kit run then holds the kit's two rules over each file the repository run matched.
It reads no repository config and no count in `stylelint-suppressions.json`, so neither turns those rules off.

### The kit's two rules

The kit run refuses two CSS constraints a program can decide, a transition over `all` and a body-wide `user-select`:

| Rule | What it refuses | Why |
| --- | --- | --- |
| `declaration-property-value-disallowed-list` | `all` in the value of `transition` or `transition-property`, vendor prefixes included, such as `transition: all 200ms` or `-webkit-transition: opacity 1s, all 1s` | every property that changes then animates, including the ones that make the browser lay out the page again |
| `rule-selector-property-disallowed-list` | `user-select` or a prefixed `user-select` such as `-webkit-user-select` in a rule whose selector list holds `html`, `body`, `:root` or `*`, or one of them inside `:global()` | a visitor cannot select or copy any text on the page |

The second rule refuses any value on those selectors, so `body { user-select: text; }` fails as well.
It matches each item of the selector list as a whole.
So it does not follow `:is()`, `:where()` or `:not()`, nor a compound such as `html body` or `body *`.
A nested rule is judged by its own selector, so `.card { * { user-select: none; } }` fails as `*`.
A control that needs selection off sets it on its own selector, such as `.drag-handle { user-select: none; }`, which this rule passes and the Baseline family reports.

### The rule families

`defineConfig` from `@avi2dg/checks/stylelint` builds the config the repository run holds:

| Family | Rules | Default |
| --- | --- | --- |
| G1 correctness | `stylelint-config-recommended`, the stylelint team's rules for likely mistakes, such as `font-variant-numeric: oldstyle-num` for `oldstyle-nums` | on |
| G2 conventions | `stylelint-config-standard`, which extends G1 with the stylelint team's notation and spacing rules | on |
| G3 selector complexity | `selector-max-specificity` at `0,3,2` and `selector-max-compound-selectors` at 3 | on |
| G4 design tokens | `color-no-hex`, `color-named: "never"`, `function-disallowed-list` over `rgb`, `rgba`, `hsl`, `hsla`, `hwb`, `lab`, `lch`, `oklab`, `oklch` and `color`, `font-size` only as one `var(--…)` with no fallback, or `inherit`, `font` only as `inherit`, or as such a `var(--…)` for its size after any literal style, variant, weight or width, and before an optional line height and a family list of names, strings and `var(--…)`s, and `checks/font-size-from-tokens`, which refuses a `var(--…)` for a size or a family naming a custom property that any style block or attribute of the same file sets, unless the file sets it only to another such `var(--…)`, or for a family to a family list, and refuses a named size such as `small` or `math` at the one place the size can still stand, the first family word after any style, variant, weight or width while no line height fixes the `var(--…)` as the size, written there or set there by such a property | off until `tokens` names the token files, and off in those files |
| G5 Baseline target | `plugin/use-baseline` from `stylelint-plugin-use-baseline`, which judges each property, value, function, at-rule, selector and unit against the Baseline data, and passes a property inside an `@supports` block. It passes `@property` at every target, since a browser without `@property` treats the declaration as an unregistered custom property | on, at the target `baseline` sets |
| G6 comments refused | `comment-word-disallowed-list` over `/^[\s\S]*$/`, which refuses every comment, including an empty `/* */` | on |
| G7 language-free selectors | `selector-disallowed-list` over `/[^\x00-\x7F]/`, which refuses any selector holding a non-ASCII character, in attribute values, class names and ids alike | on |
| G8 BEM names | `selector-class-pattern` over one lowercase block with kebab `__element` and `--modifier` parts | off until `bem` is `true` |
| G9 class-only flat selectors | `selector-max-type` at 0, `selector-max-id` at 0, `selector-max-universal` at 0, `selector-max-compound-selectors` at 2, `max-nesting-depth` at 0, `selector-max-attribute` at 0, and `selector-pseudo-class-disallowed-list` over the positional pseudo-classes, from `:first-child` to `:nth-last-of-type` | off until `flatSelectors` is `true` |
| G10 page-wide has refused | `selector-disallowed-list` with `splitList` over a pattern that refuses a `:has` beside `html`, `body`, `main` or `:root` in one selector of a list, across line breaks in the selector, and one that refuses a `:has` in a compound of pseudo-classes alone, such as `:has(.hero)`, `:scope:has(.hero)` or `:not(.card):has(.hero)`, whose subject can be the root. A nested `:has` escapes it unless G9 refuses the nesting | off until `noPageHas` is `true` |

The builder changes four of the shared config's rules:

- `no-descending-specificity` is off, since it compares only the last compound selector and has no access to the DOM.
  It reports components that never match one element.
- `property-no-vendor-prefix` keeps reporting without a fix, and passes `-webkit-user-select`, since its fix deletes the prefix Safari still needs.
- `selector-class-pattern` holds BEM names while `bem` is `true`, since the shared kebab case refuses `__` and `--`.
- In an `.html` or `.astro` file, `declaration-block-single-line-max-declarations` is off, since a `style` attribute is one line.

The comment rule refuses every comment but a sourcemap `/*# */` one, which stylelint passes to keep the map.
CSS repetition is not a family of this gate: a repository adds `"css"` to `format` in `.jscpd.json`, and [checks-repetition](checks-repetition.md) then fails when a stylesheet's repeated lines grow.
A stylesheet's length is not a family of this gate either, and [checks-css-size](checks-css-size.md) fails one that holds more than 400 lines.

### What no comment turns off

It sets stylelint's `ignoreDisables`, so a `stylelint-disable` comment silences nothing in either run, and [checks-comment-gate](checks-comment-gate.md) refuses one on the line that adds it.
A repository adopts a family over existing problems by counting them in `stylelint-suppressions.json` with `--suppress`.
stylelint lets a file and rule through while its problems stay within the count, and [checks-suppressions-ratchet](checks-suppressions-ratchet.md) fails a change that raises a count.
`--suppress` counts only what the repository run reports, and a file that does not parse still fails in the kit run.

### Files

It judges each `.css` file, and each `<style>` block and `style` attribute in an `.html`, `.astro`, `.vue` or `.svelte` file, through `postcss-html`.
It reports a file that does not parse, since it cannot judge one.
It fails on each declared input that matches no file, so an input that a renamed directory or a skipped build leaves empty never passes.

These are outside what it decides:

- A `transition` shorthand that names no property, such as `transition: 200ms`, which the browser reads as `all`.
- A value it cannot see, such as `transition: var(--motion)`, a style a script sets, or a colour a build writes into CSS outside the declared inputs.
- A font size custom property that one stylesheet outside the token files sets and another reads.
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

It imports `stylelint.config.ts` from the same directory, and passes its default export to stylelint:

```ts
import { defineConfig } from "@avi2dg/checks/stylelint";

export default defineConfig({
  baseline: "widely",
  tokens: ["src/styles/tokens.css"],
});
```

`baseline` and `tokens` have no default, since only the repository knows them, so `tsc` refuses a config that leaves either out.
The builder throws when the gate loads such a config anyway.

| Key | Takes |
| --- | --- |
| `baseline` | `"widely"`, `"newly"` or a year such as `2024`, which allows what became Baseline newly available in that year or earlier |
| `tokens` | the globs of the files that declare the design tokens, which turns G4 on in every other file, or `false` |
| `bem` | `true` to turn G8 on, left out to leave it off |
| `flatSelectors` | `true` to turn G9 on, left out to leave it off |
| `noPageHas` | `true` to turn G10 on, left out to leave it off |

`rules`, `overrides`, `ignoreFiles` and the other keys mean what they mean in stylelint's own docs, and land after the kit's.
An accepted exception lives there rather than in a comment, such as a property the Baseline rule passes:

```ts
rules: { "plugin/use-baseline": [true, { available: "widely", ignoreProperties: { "user-select": ["none"] } }] },
```

`@property` needs no such exception, since the kit passes it at every target, and adds it to the `ignoreAtRules` of a `plugin/use-baseline` entry the repository sets.

The builder owns `extends` and `plugins`.
It resolves the shared config, the plugin and `postcss-html` beside the kit, so they need not sit under the directory the gate runs in.
stylelint cannot load `stylelint.config.ts` itself under TypeScript 7, so a bare `stylelint --fix` finds no config, and the gate's `--fix` stands in for it.
A config not built with `defineConfig` names its own `customSyntax` for markup, or each `.html` or `.astro` file fails to parse in the repository run.

The repository installs the optional peers the gate loads, at the versions the kit pins:

<!-- generated install: bun run build writes it from package.json and scripts/doc-blocks.ts -->

```sh
bun add -d postcss-html@2.0.0 postcss-value-parser@4.2.0 stylelint@17.16.0 stylelint-config-standard@40.0.0 stylelint-plugin-use-baseline@1.4.7
```

<!-- end generated install -->

## Arguments

```sh
checks-frontend-syntax [--fix] [--suppress] [<directory>]
```

It checks the directory it runs in, or the directory it is given.
`--fix` rewrites what a rule of the config fixes, such as `#ffffff` to `#fff`, and reports what is left.
`--suppress` writes each problem the config reports into `stylelint-suppressions.json`, and drops a count whose problems are gone.

## Exit codes

| Code | When |
| --- | --- |
| 0 | every declared input matches a file, and no file holds a problem beyond its suppressed count |
| 1 | a file holds a problem or does not parse, or a declared input matches no file |
| 2 | `frontend-syntax.json` is missing or does not decode, its input list is empty, `stylelint.config.ts` is missing or does not load, stylelint refuses an option, a peer cannot load, or an argument is unknown |

## Sample output

```
frontend-syntax: 4 problem(s) in 2 file(s) from 3 declared input(s):
  dist/**/*.html: the declared input matches no file
  src/layouts/Base.astro:4:15 Disallowed property "user-select" for selector "body". Leave text selectable across the page, and turn selection off only on the control that needs it.
  src/styles/site.css:1:17 Disallowed value "all 200ms" for property "transition". Name the properties the transition animates.
  src/styles/site.css:9:1 Too high specificity in ".nav .item.is-open > a:hover", maximum "0,3,2" (selector-max-specificity)
```

A passing run counts what it judged:

```
frontend-syntax: no violation in 2 file(s) from 2 declared input(s)
```

## When it runs

`checks-lint` runs it in the full run when the repository tracks `frontend-syntax.json` at its root.
A repository without that file never runs it and needs neither `stylelint.config.ts` nor the peers.

## Related topics

- [checks-browser](checks-browser.md)
- [checks-lint](checks-lint.md)
- [checks-comment-gate](checks-comment-gate.md)
- [checks-css-size](checks-css-size.md)
- [checks-suppressions-ratchet](checks-suppressions-ratchet.md)
- [checks-repetition](checks-repetition.md)
- [Native settings](../configs/native-settings.md)
