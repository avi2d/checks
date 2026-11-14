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


test("layout ignores text a descendant already clips", async () => {
  const SR = "position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0;";
  const pages = {
    "sr-button.html": page(`<p><button style="overflow: hidden; width: 40px; height: 40px; border-radius: 20px"><span style="${SR}">Close the navigation menu with extra words</span></button></p>`),
    "ellipsis-child.html": page(`<p><a href="/" style="display: block; overflow: hidden; width: 200px"><span style="display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap">Contact the owner of the site with a very long label</span></a></p>`),
  };
  const site = await browserSite({
    ...sitePages(pages),
    "browser-checks.json": declaration({ routes: routesOf(pages), targets: [{ name: "link", selector: "main a", routes: ["/ellipsis-child.html"] }, { name: "button", selector: "main button", routes: ["/sr-button.html"] }], checks: ["layout"] }),
  });
  const passed = await site.run();
  expect(failuresOf(passed.text)).toEqual([]);
  expect(passed.text).toContain(`browser: ${at("layout", "/sr-button.html").slice(0, -1)} scanned button 1`);
  expect(passed.text).toContain(`browser: ${at("layout", "/ellipsis-child.html").slice(0, -1)} scanned link 1`);
  expect(passed.exitCode).toBe(0);
}, 120_000);

test("layout reports shadow text and scrollable overflow", async () => {
  const SHADOW_CLIP = `<script>customElements.define("x-clip", class extends HTMLElement { constructor() { super(); this.attachShadow({ mode: "open" }).innerHTML = "<span style='white-space: nowrap'>Contact the owner of the site</span>"; } });</` + `script>`;
  const pages = {
    "shadow-clip.html": page(`<p><x-clip style="display: inline-block; width: 40px; height: 20px; overflow: hidden; white-space: nowrap"></x-clip></p>${SHADOW_CLIP}`),
    "auto-clip.html": page(`<p><a href="/" style="display: inline-block; width: 40px; overflow: auto; white-space: nowrap">Contact the owner with a long label</a></p>`),
    "static-cut.html": page(`<p><a href="/" style="display: inline-block; overflow: hidden; width: 40px; white-space: nowrap"><span>Contact the owner with a long label</span></a></p>`),
    "clip-cut.html": page(`<p><a href="/" style="display: inline-block; overflow: hidden; width: 40px; white-space: nowrap"><span style="clip-path: inset(0)">Contact the owner with a long label</span></a></p>`),
    "indent-cut.html": page(`<p><a href="/" style="display: block; overflow: hidden; width: 280px; height: 20px; padding-left: 16px; text-indent: -16px">Contact the owner of the site with a very long label that wraps onto more lines</a></p>`),
    "perspective.html": page(`<p><a href="/" style="display: inline-block; overflow: hidden; width: 60px; height: 20px; white-space: nowrap"><span style="display: block; perspective: 1px"><span style="position: absolute; white-space: nowrap">Contact the owner with a long label</span></span></a></p>`),
  };
  const site = await browserSite({
    ...sitePages(pages),
    "browser-checks.json": declaration({ routes: routesOf(pages), targets: [{ name: "link", selector: "main a", routes: ["/auto-clip.html", "/static-cut.html", "/perspective.html", "/clip-cut.html", "/indent-cut.html"] }, { name: "clip", selector: "main x-clip", routes: ["/shadow-clip.html"] }], checks: ["layout"] }),
  });
  const failed = await site.run();
  const failures = failuresOf(failed.text);
  expect(failures.filter((line) => line.startsWith(at("layout", "/auto-clip.html")) && line.includes("clips its own text"))).not.toEqual([]);
  expect(failures.filter((line) => line.startsWith(at("layout", "/shadow-clip.html")) && line.includes("clips its own text"))).not.toEqual([]);
  expect(failures.filter((line) => line.startsWith(at("layout", "/static-cut.html")) && line.includes("clips its own text"))).not.toEqual([]);
  expect(failures.filter((line) => line.startsWith(at("layout", "/perspective.html")) && line.includes("clips its own text"))).not.toEqual([]);
  expect(failures.filter((line) => line.startsWith(at("layout", "/clip-cut.html")) && line.includes("clips its own text"))).not.toEqual([]);
  expect(failures.filter((line) => line.startsWith(at("layout", "/indent-cut.html")) && line.includes("clips its own text"))).not.toEqual([]);
  expect(failed.exitCode).toBe(1);
}, 120_000);

test("layout leaves escaped and clipped-hidden text silent", async () => {
  const SR = "position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0;";
  const pages = {
    "abs-escape.html": page(`<p><a href="/" style="display: inline-block; overflow: hidden; width: 40px; height: 20px">Hi<span style="display: block; overflow: hidden"><span style="position: absolute; left: 100px; white-space: nowrap">A tooltip shown in full</span></span></a></p>`),
    "sr-link.html": page(`<p><a href="/" style="position: relative; display: inline-block; overflow: hidden; width: 40px; height: 40px"><span style="${SR}">Close the navigation menu with extra words</span></a></p>`),
    "clip-hidden.html": page(`<p><a href="/" style="position: relative; display: inline-block; overflow: hidden; width: 40px; height: 40px"><span style="position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip-path: inset(50%); white-space: nowrap; border: 0;">Close the navigation menu with extra words</span></a></p>`),
    "indent.html": page(`<p><a href="/" style="display: block; overflow: hidden; width: 40px; text-indent: -9999px; white-space: nowrap">Contact the owner with a long label</a></p>`),
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
