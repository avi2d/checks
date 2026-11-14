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
test("layout stays silent when tight leading fits and when a scaled box fits", async () => {
  const pages = {
    "tight.html": page(`<p><a href="/" style="display: block; overflow: hidden; font: 16px/1 sans-serif">Write to me gy</a></p>`),
    "scaled-fit.html": page(`<p><a href="/" style="display: inline-block; overflow: hidden; padding: 4px; transform: scale(1.1); transform-origin: 0 0">Write to me</a></p>`),
  };
  const site = await browserSite({
    ...sitePages(pages),
    "browser-checks.json": declaration({ routes: routesOf(pages), checks: ["layout"] }),
  });
  const passed = await site.run();
  expect(failuresOf(passed.text)).toEqual([]);
  for (const path of Object.keys(pages)) expect(passed.text).toContain(`browser: ${at("layout", `/${path}`).slice(0, -1)} scanned link 1`);
  expect(passed.exitCode).toBe(0);
}, 120_000);

test("layout is red when a scaled box cuts its text", async () => {
  const pages = {
    "scaled-clip.html": page(`<p><a href="/" style="display: inline-block; width: 40px; overflow: hidden; white-space: nowrap; transform: scale(0.5); transform-origin: 0 0">Contact the owner with a long label</a></p>`),
  };
  const site = await browserSite({
    ...sitePages(pages),
    "browser-checks.json": declaration({ routes: routesOf(pages), checks: ["layout"] }),
  });
  const failed = await site.run();
  const failures = failuresOf(failed.text);
  expect(failures.filter((line) => line.startsWith(at("layout", "/scaled-clip.html")) && line.includes("clips its own text"))).not.toEqual([]);
  expect(failed.exitCode).toBe(1);
}, 120_000);

