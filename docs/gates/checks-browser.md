---
kind: reference
audience: consumers
---
# checks-browser

`checks-browser` is the opt-in runner that opens a product's built pages in Chrome and fails on the measurable quality floor its declaration asks for.

## What it checks

It visits each declared route at each declared viewport in each declared state, and runs each declared check on its own fresh page.
A visit is one route, one viewport and one state.
Each check judges only the elements of a target that are visible at the visit.
So a control the page renders once for each breakpoint is judged where it shows.

| Check | What fails | Built on |
| --- | --- | --- |
| `layout` | a page wider than the viewport, and a target that overflows the viewport, is reachable only by scrolling sideways, is cut off by a container that cannot scroll, clips its own text or hides its text, overlaps another target, or is covered by any element | the DevTools protocol's boxes and hit test |
| `keyboard` | a `focusable` target that Tab does not reach once for each visible element it matches, and a Tab stop on a target that shows no visible focus | Playwright's keyboard, and a screenshot of the target with and without focus |
| `motion` | an animation or a transition longer than one frame that starts during load, on hover, on leaving a hovered control or on focus, and smooth scrolling, for a visitor who turns motion off | the page's own `document.getAnimations()`, in each state whose `reducedMotion` is `reduce` |
| `axe` | each violation of axe's WCAG 2.2 AA rules, which include `color-contrast`, `nested-interactive`, `meta-viewport` and `target-size` | axe-core through `@axe-core/playwright` |
| `nesting` | an element the HTML content model does not permit where it sits in the rendered page, such as a `<button>` inside an `<a>` | html-validate's `element-permitted-content` rule |
| `assets` | a request that fails, and a response with a status of 400 or more, while the page loads to network idle | Playwright's request and response events |

The `motion` check judges what moves on the rendered page, so a `prefers-reduced-motion` query in the source counts for nothing unless the motion stops.
It runs only in a state whose `reducedMotion` is `reduce`.
An animation that ends within one frame never moves, so the common reset that shortens every duration to near zero for reduced motion passes.
Beyond that, durations, easing and how motion feels are judgement, so no check reads them.
A control the pointer cannot reach, such as a skip link parked off the screen, is judged on focus alone, and the inventory counts it.

`layout` treats text in an SVG `<title>` or `<desc>`, under `display: none` or under `hidden` as left out, not hidden.
Transparent, zero-size, `visibility: hidden` and zero-opacity text still fail.
A `focusable` target parked off the screen or clipped until it is focused, such as a skip link, is left to `keyboard`.
The `layout` inventory counts it as parked until focused.

It does not yet check the rendered page against a product's declared design tokens, which needs a separate decision.

`axe` reports a contrast it cannot measure as unverified rather than as a pass or a failure.
Text over a background image or a gradient is such a case, and the report lists each one under its own heading.
`nested-interactive` catches a control inside an element whose role makes its children presentational, such as a link inside a `<button>` or inside a `role="button"`.
`nesting` catches a control inside a link, which axe passes.
Neither sees a parent click handler that fires with a child control's click, which a product hook tests.

### The inventory

The runner prints one line for each check at each visit.
The line names the route, its locale, the viewport, the state and what the check scanned.
At every visit, whichever checks are declared, a `targets` run counts the visible elements each target that applies to the route matches.
For `targets`, `layout`, `keyboard` and a hook, what it scanned is each target by name with the count of its elements.

It fails, rather than passes, when a declaration leaves nothing to judge:

- a declared route the site does not serve
- a declared target that matches no visible element on a route it applies to
- a route that no target applies to
- a `layout` run or a hook that scans no target
- a `keyboard` run in which Tab reaches no target
- a `motion` run that finds no visible control
- an empty list of routes, viewports, states, targets or checks, which the declaration refuses

Each failure names the check, the route, the locale, the viewport and the state, and the target or the element it found.

### Product hooks

Two checks need what only the product knows, its domain schema and its requests.
The runner calls the product's own hooks for them rather than judging them itself:

- Valid choices: a hook submits each choice a control offers on the real page, and decodes what reaches the boundary with the product's one schema.
- Async ordering: a hook answers a second request before the first, then reads the visible and the persisted result.
  It reads them again after a refused request and after a reconnect.

A hook is also where a product clicks a child control and checks that the row around it did not activate too.
The same hook can hover a control and check that no application state changed.

The declaration names the module in `hooks`.
The module exports `checks`, each a name, an optional list of the routes it runs on, and a `run` function.
The runner hands `run` a fresh page at each visit before it loads anything, so the hook can intercept requests, and the visit with its `url`.
`run` returns the names of the targets it scanned and what it found, and a hook that throws fails with its message:

```ts
import { Schema } from "effect";
import type { ProductCheck } from "@avi2dg/checks/browser-hooks.ts";
import { Language } from "../../src/domain.ts";

export const checks: readonly ProductCheck[] = [
  {
    name: "every offered language decodes at the boundary",
    routes: ["/settings/"],
    run: async (page, visit) => {
      const submitted: string[] = [];
      await page.route("**/api/language", async (route) => {
        submitted.push(route.request().postData() ?? "");
        await route.fulfill({ status: 204 });
      });
      await page.goto(visit.url);
      const offered = await page.locator("#language option").evaluateAll((options) => options.map((option) => (option as HTMLOptionElement).value));
      for (const value of offered) {
        await page.selectOption("#language", value);
        await Promise.all([page.waitForRequest("**/api/language"), page.click("#language-form button")]);
      }
      return {
        targets: offered.map(() => "language choice"),
        found: submitted.filter((value) => !Schema.is(Language)(value)).map((value) => `the language control offers ${value}, which the boundary refuses`),
      };
    },
  },
];
```

## What it reads

It reads `browser-checks.json` in the directory it runs in:

```json
{
  "site": "dist",
  "routes": [
    { "path": "/", "locale": "en" },
    { "path": "/ru/", "locale": "ru" }
  ],
  "viewports": [
    { "name": "phone", "width": 375, "height": 812, "touch": true },
    { "name": "desktop", "width": 1280, "height": 800 }
  ],
  "states": [
    { "name": "default" },
    { "name": "enlarged text", "textPx": 32 },
    { "name": "reduced motion", "reducedMotion": "reduce" }
  ],
  "targets": [
    { "name": "language switch", "selector": "header a[hreflang]", "focusable": true },
    { "name": "email contact", "selector": "main a[href^='mailto:']", "routes": ["/", "/ru/"], "focusable": true },
    { "name": "headline", "selector": "main h1" }
  ],
  "checks": ["layout", "keyboard", "motion", "axe", "nesting", "assets"],
  "hooks": "tests/browser/hooks.ts"
}
```

| Field | What it holds |
| --- | --- |
| `site` | the directory of the built site, which the runner serves on a local port, an `index.html` answering for its directory |
| `routes` | each page to visit, as a `path` from the site root and the `locale` it renders |
| `viewports` | each window to visit in, with a `name`, a `width` and a `height` in pixels, and `touch` for a phone that has touch and a mobile viewport |
| `states` | each condition to visit in, with a `name`, `textPx` for the browser's default text size, and `reducedMotion` as `reduce` or `no-preference` |
| `targets` | each named control or text the checks judge, with a CSS `selector`, the `routes` it is on when not every route, and `focusable` when Tab must reach it |
| `checks` | the built-in checks to run, from `layout`, `keyboard`, `motion`, `axe`, `nesting` and `assets` |
| `hooks` | the module of product hooks, as a path from the directory the runner runs in |

`textPx` sets the default font size, so text the page sizes in `rem` or `em` grows, as a visitor's own setting makes it grow.
A declaration that names a route, viewport, state, target or check twice is refused.
So are a `motion` check with no state whose `reducedMotion` is `reduce`, a `keyboard` check with no `focusable` target, and a target or a hook that names an undeclared route.

It drives the Chrome the machine has, which `CHROME_PATH` names, or Chrome's standard install when it is unset.
The product installs the optional peers the runner loads, at the versions the kit pins:

```sh
bun add -d playwright-core@1.63.0 @axe-core/playwright@4.13.0 html-validate@11.16.0
```

## Arguments

```sh
checks-browser [<directory>]
```

It reads the declaration in the directory it runs in, or in the directory it is given.

## Exit codes

| Code | When |
| --- | --- |
| 0 | every check passes at every visit, and every declared route and target is there |
| 1 | a check fails at a visit, a declared route is not served, a declared target matches no visible element, or a run scans no target |
| 2 | `browser-checks.json` is missing, does not decode or contradicts itself, the site directory or the hooks module is missing, a peer cannot load, or Chrome cannot start |

## Sample output

```
browser: targets at /ru/ (ru), phone 375x812 touch, enlarged text scanned language switch 1, email contact 1, headline 1
browser: layout at /ru/ (ru), phone 375x812 touch, enlarged text scanned language switch 1, email contact 1, headline 1
browser: keyboard at /ru/ (ru), phone 375x812 touch, enlarged text scanned language switch 1, email contact 1
browser: axe at /ru/ (ru), phone 375x812 touch, enlarged text scanned 11 rule(s)
browser: 1 contrast check(s) axe cannot measure, reported as unverified:
  axe at /ru/ (ru), phone 375x812 touch, enlarged text: color-contrast unverified: header > p: Element's background color could not be determined due to a background image
browser: 2 failure(s) in 4 check run(s) over 1 route(s), 1 viewport(s), 1 state(s) and 3 target(s):
  layout at /ru/ (ru), phone 375x812 touch, enlarged text: email contact "Написать письмо владельцу" clips its own text
  axe at /ru/ (ru), phone 375x812 touch, enlarged text: nested-interactive (serious): button: Interactive controls must not be nested
```

## When it runs

A product runs it after it builds its site, in a script of its own such as `"test:browser": "astro build && checks-browser"`.
`checks-lint` never runs it, and a repository without `browser-checks.json` never starts a browser or needs the peers.

## Related topics

- [checks-frontend-syntax](checks-frontend-syntax.md)
- [checks-lint](checks-lint.md)
