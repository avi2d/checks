---
kind: reference
audience: consumers
---
# checks-browser

`checks-browser` is the opt-in runner that opens a product's built pages in Chrome and fails on the measurable quality floor its declaration asks for.

## What it checks

It visits each declared route at each declared viewport in each declared state.
Each declared check that opens a page runs on its own fresh page.
A visit is one route, one viewport and one state.
Each check judges only the elements of a target that are visible at the visit.
So a control the page renders once for each breakpoint is judged where it shows.

| Check | What fails | Built on |
| --- | --- | --- |
| `layout` | a page wider than the viewport, and a target that overflows the viewport, is reachable only by scrolling sideways, is cut off by a container that cannot scroll, clips its own text or hides its text, overlaps another target, or is covered by any element | the DevTools protocol's boxes and hit test |
| `keyboard` | a `focusable` target that Tab does not reach once for each element it matches that is visible before the first Tab press, and a Tab stop on a target that shows no visible focus | Playwright's keyboard, and viewport screenshots before and after blur compared within the crop of the focused element and the ancestors changed by focus, with what their pseudo-elements paint |
| `motion` | an animation or a transition longer than one frame that starts during load, on hover, on leaving a hovered control or on focus, and smooth scrolling, for a visitor who turns motion off | the page's own `document.getAnimations()`, in each state whose `reducedMotion` is `reduce` |
| `axe` | each violation of axe's WCAG 2.2 AA rules, which include `color-contrast`, `nested-interactive`, `meta-viewport` and `target-size` | axe-core through `@axe-core/playwright` |
| `nesting` | an element the HTML content model does not permit where it sits in the rendered page, such as a `<button>` inside an `<a>` | html-validate's `element-permitted-content` rule |
| `html` | an error from html-validate's `html-validate:standard` or `html-validate:a11y` preset, or from `input-missing-label`, in the page the server sends | html-validate on the page's HTML as the server sends it |
| `links` | a link on the rendered page to a page of the same site that answers with a status of 400 or more, and a link whose fragment names no element on the page it points at | the `href` of each `<a>` and `<area>`, fetched from the local server, and the `id` and `<a name>` of the page each fragment points at, loaded in Chrome |
| `assets` | a request that fails, a response with a status of 400 or more, a request to another origin, an error the page logs to the console and an error the page throws and never catches, while the page loads to network idle | Playwright's request, response, console and page error events |
| `contrast` | a box of text in a `contrast` target whose letters, as drawn, fall below WCAG 2.2's 4.5:1 against the backdrop around them, or below 3:1 from 24px up, and a `contrast` target with no text on screen or whose letters draw nothing | three screenshots of the page: as drawn, with the targets' text painted one marker colour and with it cleared |
| `weight` | a page that transfers more bytes than the budgets in `weight` allow, counted apart as outside images, in scripts and in images | the body of each response from the page's own origin, gzipped outside images and raw in images |
| `shift` | a cold load whose summed layout movement passes the bound in `shift` | a recorder that sums each `layout-shift` entry without a recent input |

`html` runs once for each route, at the first viewport in the first state, because the page the server sends is the same at each.
`links` runs once at the same visit, since it reads every link in the page, whether the viewport shows it or not.

`links` judges the links on each declared route.
A page they point at is fetched, and loaded when a link names a fragment on it.
Its own links are judged only when a route declares it.
A link to another origin, or one such as `mailto:` that has none, is left alone.
A fragment of `top`, in any case, points at the start of the page, as the HTML standard has it.
So it needs no element of that name.
A fragment is decoded before it is compared, so `#%D1%83%D1%81%D0%BB%D1%83%D0%B3%D0%B8` matches `id="услуги"`.
It reads no `robots` meta, so a page marked `noindex` or `nofollow` is judged like any other.

`assets` takes the page's own origin as the local server's, so a script, font or image from any other host, port or scheme fails it.
A `data:` address has no origin and is left alone.
Chrome logs a failed resource as a console error, so the request and the log name it twice.

The `motion` check judges what moves on the rendered page, so a `prefers-reduced-motion` query in the source counts for nothing unless the motion stops.
It runs only in a state whose `reducedMotion` is `reduce`.
An animation that ends within one frame never moves, so the common reset that shortens every duration to near zero for reduced motion passes.
Beyond that, durations, easing and how motion feels are judgement, so no check reads them.
A control the pointer cannot reach, such as a skip link parked off the screen, is judged on focus alone, and the inventory counts it.

`layout` treats text in an SVG `<title>` or `<desc>`, in a `<textarea>`, or that the browser does not render as left out, not hidden.
Text that is not rendered includes `display: none`, `hidden`, the options of a closed `<select>` and a closed `<details>`.
An element with `display: contents`, such as a framework island, has no box of its own but its content renders, so its text is judged.
Transparent, zero-size, `visibility: hidden` and zero-opacity text still fail.
A `focusable` target parked off the screen or clipped until it is focused, such as a skip link, is left to `keyboard`.
The `layout` inventory counts it as parked until focused.

It does not yet check the rendered page against a product's declared design tokens, which needs a separate decision.

`axe` reports a contrast it cannot measure as unverified rather than as a pass or a failure.
Text over a background image or a gradient is such a case, and the report lists each one under its own heading.
`contrast` measures that text for the targets that set `contrast`.

`contrast` waits for the page's images in view and for each entrance animation, up to ten seconds, then pauses every animation where it stands.
For each line of a target's text it compares the letters' pixels with the backdrop's pixels in a ring two pixels wide around them.
It reads the letters' pixels where the marker colour lands.
The letters' lightest or darkest pixels, whichever stand furthest from the backdrop, give their colour.
The ratio it reports is the 5th percentile of the ring, so a bright stretch of a photo behind one letter is not averaged away.
A shadow or a halo stays painted when the text is cleared, so it counts as backdrop.
It needs 3:1 for text from 24px, as WCAG 2.2 counts 18pt large text, and 4.5:1 below that, without telling bold 14pt text from regular.
It measures only what the viewport shows at the top of the page, so text below the fold reads as no text on screen.
Text that is only whitespace is left out, since it paints no letter to measure.
Text a canvas or an image draws is not text it can find.
Letters filled by `-webkit-text-fill-color` ignore the marker colour, so they read as drawing nothing.
A backdrop a pseudo-element or an SVG paints with `currentColor` changes with the marker, so its text reads as drawing nothing.
The large-text threshold reads the CSS font-size, so text a transform or zoom scales is held to the threshold of its unscaled size.

`weight` reads the body of each response the page serves from its own origin.
It weighs images raw and gzips every other body, so the count reads the bytes on the wire.
It scrolls to the page end and waits for the rendered images and the settled fonts, so lazy content and webfonts count.
A run that weighs no response fails, since an empty measurement cannot pass.

`shift` sums each layout shift entry without a recent input, from before the first paint until the load settles.
It opens each visit in a fresh context, so each measurement is a cold load.
It waits for the settled fonts, the rendered images and two frames before it sums.
A run whose recorder never ran fails, since an empty measurement cannot pass.

`nested-interactive` catches a control inside an element whose role makes its children presentational, such as a link inside a `<button>` or inside a `role="button"`.
`nesting` catches a control inside a link, which axe passes.
`html` reads the page as the server sends it, so it never sees markup a script builds.
Of its rules, only the content model reaches that markup, through `nesting` on the rendered page.
None of these sees a parent click handler that fires with a child control's click, which a product hook tests.

### The inventory

The runner prints one line for each check at each visit, narrowed by the `html`, `links` and `motion` exceptions above.
The line names the route, its locale, the viewport, the state and what the check scanned.
At every visit, whichever checks are declared, a `targets` run counts the visible elements each target that applies to the route matches.
For `targets`, `layout`, `keyboard`, `contrast` and a hook, what it scanned is each target by name with the count of its elements.

It fails, rather than passes, when a declaration leaves nothing to judge:

- a declared route the site does not serve
- a declared target that matches no visible element on a route it applies to
- a route that no target applies to
- a `layout` run or a hook that scans no target
- a `keyboard` run in which Tab reaches no target
- a `motion` run that finds no visible control
- a `contrast` run with no `contrast` target on the route, a `contrast` target with no text on screen, and a line of text whose letters draw nothing
- a `weight` run that weighs no response from the page's own origin
- a `shift` run whose recorder never ran
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
    { "preset": "anchor" },
    { "name": "small laptop", "width": 1280, "height": 720, "device": "desktop" }
  ],
  "states": [
    { "name": "default" },
    { "preset": "enlarged-text" },
    { "name": "reduced motion", "reducedMotion": "reduce" }
  ],
  "targets": [
    { "name": "language switch", "selector": "header a[hreflang]", "focusable": true },
    { "name": "email contact", "selector": "main a[href^='mailto:']", "routes": ["/", "/ru/"], "focusable": true },
    { "name": "headline", "selector": "main h1" }
  ],
  "checks": ["layout", "keyboard", "motion", "axe", "nesting", "html", "links", "assets", "weight", "shift"],
  "weight": { "nonImageBytes": 700000, "scriptBytes": 450000, "imageBytes": 500000 },
  "shift": { "max": 0.1 },
  "hooks": "tests/browser/hooks.ts"
}
```

| Field | What it holds |
| --- | --- |
| `site` | the directory of the built site, which the runner serves on a local port, an `index.html` answering for its directory |
| `routes` | each page to visit, as a `path` from the site root and the `locale` it renders |
| `viewports` | each window to visit in, with a `name`, a `width` and a `height` in pixels, `touch` for a phone that has touch and a mobile viewport, and `device` as `phone`, `tablet` or `desktop`, or a `preset` that stands for a set of screen sizes |
| `states` | each condition to visit in, with a `name`, `textPx` for the browser's default text size, and `reducedMotion` as `reduce` or `no-preference`, or the `enlarged-text` preset |
| `targets` | each named control or text the checks judge, with a CSS `selector`, the `routes` it is on when not every route, `focusable` when Tab must reach it, and `contrast` when `contrast` measures its text |
| `checks` | the built-in checks to run, from `layout`, `keyboard`, `motion`, `axe`, `nesting`, `html`, `links`, `assets`, `contrast`, `weight` and `shift` |
| `weight` | the byte budgets each page must hold, as `nonImageBytes` outside images, `scriptBytes` in scripts and `imageBytes` in images |
| `shift` | the largest total layout movement a cold load may report, as `max` |
| `hooks` | the module of product hooks, as a path from the directory the runner runs in |

`textPx` sets the default font size, so text the page sizes in `rem` or `em` grows, as a visitor's own setting makes it grow.
A declaration that names a route, viewport, state, target or check twice is refused.
So are a `motion` check with no state whose `reducedMotion` is `reduce` and a `keyboard` check with no `focusable` target.
So is a `contrast` check with no `contrast` target, and a target or a hook that names an undeclared route.
So is a `weight` check with no `weight` budgets, and a `shift` check with no `shift` bound.

### Screen sizes

A viewport `{ "preset": "anchor" }` stands for the anchor set of screen sizes, and `{ "preset": "full" }` for the full set.
The full set holds the anchors and eleven more sizes.
A product runs the anchor set on every pull request and the full set on a run started by hand.
Each size in a set is a viewport named for its device and its size, with `device` set, and each phone also sets `touch`.
A preset sits beside a product's own viewports.
A name both declare is refused as declared twice, and so is a size that two listed presets both hold.
A product's own code takes the sizes by importing `SCREEN_SIZES`, `screenSizeName` and `ENLARGED_TEXT_PX` from `@avi2dg/checks/screen-sizes.ts`.
A block's screenshot suite runs at the same sizes, as [Test the screens of one block](../how-to/test-a-blocks-screens.md) says.

<!-- generated screen-sizes: bun run build writes it from SCREEN_SIZES in src/quality/browser/screen-sizes.ts and scripts/doc-blocks.ts -->

| Device | Width | Height | Name | Sets |
| --- | --- | --- | --- | --- |
| phone | 360 | 640 | `phone-360x640` | `anchor` and `full` |
| phone | 375 | 667 | `phone-375x667` | `anchor` and `full` |
| phone | 393 | 852 | `phone-393x852` | `anchor` and `full` |
| phone | 412 | 915 | `phone-412x915` | `anchor` and `full` |
| tablet | 820 | 1180 | `tablet-820x1180` | `anchor` and `full` |
| desktop | 1366 | 768 | `desktop-1366x768` | `anchor` and `full` |
| desktop | 1440 | 900 | `desktop-1440x900` | `anchor` and `full` |
| desktop | 1920 | 1080 | `desktop-1920x1080` | `anchor` and `full` |
| phone | 320 | 568 | `phone-320x568` | `full` |
| phone | 360 | 540 | `phone-360x540` | `full` |
| phone | 375 | 567 | `phone-375x567` | `full` |
| phone | 375 | 812 | `phone-375x812` | `full` |
| phone | 390 | 844 | `phone-390x844` | `full` |
| phone | 430 | 932 | `phone-430x932` | `full` |
| tablet | 768 | 1024 | `tablet-768x1024` | `full` |
| tablet | 1024 | 1366 | `tablet-1024x1366` | `full` |
| desktop | 1280 | 800 | `desktop-1280x800` | `full` |
| desktop | 1536 | 864 | `desktop-1536x864` | `full` |
| desktop | 2560 | 1440 | `desktop-2560x1440` | `full` |

<!-- end generated screen-sizes -->

The state `{ "preset": "enlarged-text" }` stands for a state named `enlarged text` whose `textPx` is 32.
The sizes were checked on 2026-10-31 against four sources.
They are StatCounter's screen resolution statistics, the point sizes in Apple's Human Interface Guidelines, Material Design's device metrics and the Chrome UX Report.
They are due for a recheck against those sources once a year.

### Start from the shipped declaration

The kit ships a starter declaration, which a product copies and then edits to its own routes and targets:

```sh
cp node_modules/@avi2dg/checks/src/quality/browser/browser-checks.json browser-checks.json
```

A host resolves it as `@avi2dg/checks/browser-checks.json`.

<!-- generated starter: bun run build writes it from src/quality/browser/browser-checks.json and scripts/doc-blocks.ts -->

```json
{
  "site": "dist",
  "routes": [
    { "path": "/", "locale": "en" }
  ],
  "viewports": [
    { "preset": "anchor" }
  ],
  "states": [
    { "name": "default" },
    { "preset": "enlarged-text" },
    { "name": "reduced motion", "reducedMotion": "reduce" }
  ],
  "targets": [
    { "name": "headline", "selector": "main h1" },
    { "name": "link", "selector": "a[href]", "focusable": true }
  ],
  "checks": ["layout", "keyboard", "motion", "axe", "nesting", "html", "links", "assets"]
}
```

<!-- end generated starter -->

For a run started by hand, a product keeps a second declaration in a directory of its own.
Its `site` is a path from that directory, such as `../dist`, and its viewports are `{ "preset": "full" }`.
It runs `checks-browser <directory>` on that directory.

### Chrome and the peers

It drives the Chrome the machine has, which `CHROME_PATH` names, or Chrome's standard install when it is unset.
The product installs the optional peers the runner loads, at the versions the kit pins:

<!-- generated install: bun run build writes it from package.json and scripts/doc-blocks.ts -->

```sh
bun add -d @axe-core/playwright@4.13.0 html-validate@11.16.0 playwright-core@1.63.0
```

<!-- end generated install -->

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
browser: targets at /ru/ (ru), phone-375x667 375x667 touch, enlarged text scanned language switch 1, email contact 1, headline 1
browser: layout at /ru/ (ru), phone-375x667 375x667 touch, enlarged text scanned language switch 1, email contact 1, headline 1
browser: keyboard at /ru/ (ru), phone-375x667 375x667 touch, enlarged text scanned language switch 1, email contact 1
browser: axe at /ru/ (ru), phone-375x667 375x667 touch, enlarged text scanned 11 rule(s)
browser: 1 contrast check(s) axe cannot measure, reported as unverified:
  axe at /ru/ (ru), phone-375x667 375x667 touch, enlarged text: color-contrast unverified: header > p: Element's background color could not be determined due to a background image
browser: 2 failure(s) in 4 check run(s) over 1 route(s), 1 viewport(s), 1 state(s) and 3 target(s):
  layout at /ru/ (ru), phone-375x667 375x667 touch, enlarged text: email contact "Написать письмо владельцу" clips its own text
  axe at /ru/ (ru), phone-375x667 375x667 touch, enlarged text: nested-interactive (serious): button: Interactive controls must not be nested
```

## When it runs

A product runs it after it builds its site, in a script of its own such as `"test:browser": "astro build && checks-browser"`.
`checks-lint` never runs it, and a repository without `browser-checks.json` never starts a browser or needs the peers.

## Related topics

- [checks-frontend-syntax](checks-frontend-syntax.md)
- [checks-lint](checks-lint.md)
