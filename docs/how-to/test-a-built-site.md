---
kind: how-to
audience: consumers
---
# Test a built site in a browser

A repository owner follows these steps to serve a site the build already wrote and test its pages in Chromium or WebKit.

## Before you begin

- `playwright-core` installed at the version the kit's `package.json` lists among its `peerDependencies`.
- Playwright's Chromium headless shell and WebKit, installed with `bunx playwright-core install --with-deps chromium-headless-shell webkit`.
- A build that writes the site to one folder, such as `dist/`.

## Add a test

To add a test of the built site:

1. Write a test file under `tests/e2e/`:

   ```ts
   import { expect } from "bun:test";
   import { join } from "node:path";
   import { pageUrl, siteTest } from "@avi2dg/checks/site-test.ts";

   siteTest("every page has a title", { site: join(import.meta.dir, "..", "..", "dist"), engine: "webkit" }, async (site) => {
     const page = await (await site.browser.newContext()).newPage();
     for (const path of site.pages) {
       await page.goto(pageUrl(site, path));
       expect(await page.title()).not.toBe("");
     }
   });
   ```

1. Build the site.
1. Run `bun run test:e2e`.

`siteTest` registers one Bun test.
The test reads the folder, serves it on a free local port and passes the test function a site with three fields:

| Field | What it holds |
| --- | --- |
| `url` | the address the site is served at, ending in `/` |
| `pages` | each `.html` file in the folder, sorted, with `about/index.html` named `/about/` |
| `browser` | a Playwright browser of the engine the test names |

`pageUrl(site, path)` turns a path from `pages` into the full address.
The server answers a folder asked for without its last `/` with a redirect to it, and anything missing with a 404.
When the test ends, the server stops and every browser context the test opened closes.
Each browser stays open for the next test in the file that names the same engine and launch options, and closes after the last.

| Key | What it takes |
| --- | --- |
| `site` | the folder the build wrote, or a function that returns a promise of it, such as one that builds the site once for every test |
| `engine` | `chromium`, the default, or `webkit` |
| `launch` | Playwright launch options, such as `executablePath` for a full Chrome instead of the headless shell |
| `timeoutMs` | how long the test may take, 120 seconds when the key is left out |

Chromium launches with `--font-render-hinting=none` beside any `args` in `launch`, as the screens of a block do.

## Troubleshooting

### the site dist is not a directory, so build the site before its tests run

The folder `site` names does not exist.
Build the site first, or pass a function that builds it.

### the built site at dist holds no .html page

The build wrote no page into the folder, so no test could reach one.
Point `site` at the folder the build writes its pages to.

## Related topics

- [Test the screens of one block](test-a-blocks-screens.md)
- [checks-test-layout](../gates/checks-test-layout.md)
