import { expect, test } from "bun:test";
import { at, browserSite, declaration, failuresOf, page, routesOf, sitePages } from "../e2e/lib/browser-site.ts";

test("layout reports only text that a box really clips: a decorative svg overflowing a box, or text spilling out of a box that does not clip it, is silent", async () => {
  const ARROW = '<svg style="position: absolute; left: 150px; top: 0" width="120" height="20" viewBox="0 0 120 20"><path d="M0 10 H120" stroke="black"/></svg>';
  const pages = {
    "arrow.html": page(`<p class="note" style="position: relative; width: 200px"><a href="/">Write to me</a>${ARROW}</p>`),
    "clipped-arrow.html": page(`<p class="note" style="position: relative; width: 200px; overflow: hidden"><a href="/">Write to me</a>${ARROW}</p>`),
    "spill.html": page(`<p class="note" style="width: 40px"><a href="/" style="white-space: nowrap">Write to me</a></p>`),
  };
  const site = await browserSite({
    ...sitePages(pages),
    "browser-checks.json": declaration({ routes: routesOf(pages), targets: [{ name: "note", selector: "main p" }], checks: ["layout"] }),
  });
  const passed = await site.run();
  expect(failuresOf(passed.text)).toEqual([]);
  for (const path of Object.keys(pages)) expect(passed.text).toContain(`browser: ${at("layout", `/${path}`).slice(0, -1)} scanned note 1`);
  expect(passed.exitCode).toBe(0);
}, 120_000);
