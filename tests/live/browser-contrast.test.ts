import { expect, test } from "bun:test";
import { at, browserSite, declaration, failuresOf, page, routesOf, sitePages } from "../e2e/lib/browser-site.ts";

const HEADLINE = { name: "headline", selector: "h1", contrast: true };

const stripes = (one: string, other: string): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="${one}"/><rect width="20" height="40" fill="${other}"/></svg>`;

const over = (background: string): string =>
  page(`<section style="padding:24px;background:${background};background-size:cover"><h1 style="margin:0;font:700 32px/1.2 sans-serif;color:#fff">Contracts</h1></section>`);

const plain = (color: string): string => page(`<h1 style="font:400 16px/1.4 sans-serif;color:${color}">Write to me</h1>`);

const red = {
  "index.html": plain("#999"),
  "photo.html": over("url(/photo.svg)"),
  "gradient.html": over("linear-gradient(90deg, #fff, #ccc)"),
};

const lowest = (text: string, path: string): number => Number(new RegExp(`contrast at ${path} \\(en\\).*lowest ([0-9.]+):1`).exec(text)?.[1]);

test("contrast is red on grey body text and on white headlines over a light photo and a light gradient, and green once each is darkened", async () => {
  const site = await browserSite({
    ...sitePages(red),
    "dist/photo.svg": stripes("#fff", "#ddd"),
    "browser-checks.json": declaration({ routes: routesOf(red), targets: [HEADLINE], checks: ["contrast"] }),
  });
  const failed = await site.run();
  const found = failuresOf(failed.text);
  expect(found).toHaveLength(3);
  expect(found[0]).toBe(`${at("contrast", "/index.html")} headline "Write to me" box 1 reads at 2.85:1, needs 4.5:1`);
  expect(found[1]?.startsWith(`${at("contrast", "/photo.html")} headline "Contracts" box 1 reads at 1.`)).toBe(true);
  expect(found[1]).toEndWith(":1, needs 3:1");
  expect(found[2]?.startsWith(`${at("contrast", "/gradient.html")} headline "Contracts" box 1 reads at 1.`)).toBe(true);
  expect(found[2]).toEndWith(":1, needs 3:1");
  expect(failed.exitCode).toBe(1);

  await site.write({
    "dist/index.html": plain("#595959"),
    "dist/photo.svg": stripes("#222", "#000"),
    "dist/gradient.html": over("linear-gradient(90deg, #000, #333)"),
  });
  const passed = await site.run();
  expect(failuresOf(passed.text)).toEqual([]);
  expect(lowest(passed.text, "/index.html")).toBeGreaterThan(4.5);
  expect(lowest(passed.text, "/photo.html")).toBeGreaterThan(3);
  expect(lowest(passed.text, "/gradient.html")).toBeGreaterThan(3);
  expect(passed.exitCode).toBe(0);
}, 120_000);

test("contrast fails a declared target the page does not show or draws faded out, rather than passing it with nothing measured", async () => {
  const site = await browserSite({
    "dist/index.html": page(
      `<h1>Contracts</h1><p class="note" style="display:none">Five years of practice</p><p class="faded" style="opacity:0">Deals closed</p>`,
    ),
    "browser-checks.json": declaration({
      targets: [HEADLINE, { name: "note", selector: ".note", contrast: true }, { name: "faded", selector: ".faded", contrast: true }],
      checks: ["contrast"],
    }),
  });
  const failed = await site.run();
  expect(failuresOf(failed.text)).toEqual([
    `${at("targets", "/")} note (.note) matches no visible element`,
    `${at("contrast", "/")} note (.note) shows no text on screen to measure`,
    `${at("contrast", "/")} faded "Deals closed" box 1 draws no glyph to measure`,
  ]);
  expect(failed.exitCode).toBe(1);
}, 120_000);

test("contrast reads a headline after its entrance plays out, not at the transparent first frame of a fade", async () => {
  const site = await browserSite({
    "dist/index.html": page(
      `<h1 style="color:#000;animation:enter 1.5s ease-out 0.3s both">Contracts</h1>`,
      { head: "<style>@keyframes enter { from { opacity: 0 } to { opacity: 1 } }</style>" },
    ),
    "browser-checks.json": declaration({ targets: [HEADLINE], checks: ["contrast"] }),
  });
  const passed = await site.run();
  expect(failuresOf(passed.text)).toEqual([]);
  expect(lowest(passed.text, "/")).toBeGreaterThan(15);
  expect(passed.exitCode).toBe(0);
}, 120_000);

test("contrast measures a narrow run inside a passing heading, rather than skipping it", async () => {
  const site = await browserSite({
    "dist/index.html": page('<h1 style="font:400 16px/1.4 sans-serif;color:#000">Contracts <span style="color:#fff">I</span></h1>'),
    "browser-checks.json": declaration({ targets: [HEADLINE], checks: ["contrast"] }),
  });
  const failed = await site.run();
  expect(failuresOf(failed.text)).toEqual([
    `${at("contrast", "/")} headline "Contracts I" box 2 reads at 1.00:1, needs 4.5:1`,
  ]);
  expect(failed.exitCode).toBe(1);
}, 120_000);
