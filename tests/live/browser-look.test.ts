import { expect, test } from "bun:test";
import { at, browserSite, declaration, failuresOf, page, routesOf, sitePages } from "../e2e/lib/browser-site.ts";

const TOKENS = `:root {
  --ink: #1c1d20;
  --face: Georgia;
  --text-body: 1rem;
  --text-title: 2rem;
  --leading-body: 1.5;
  --leading-title: 1.2;
  --weight-body: 400;
  --weight-title: 700;
  --track-title: -0.02em;
}`;

const BASE = `body { margin: 0; color: var(--ink); font-family: var(--face); font-size: var(--text-body); line-height: var(--leading-body); font-weight: var(--weight-body); }
h1 { margin: 0; font-size: var(--text-title); line-height: var(--leading-title); font-weight: var(--weight-title); letter-spacing: var(--track-title); }`;

const styled = (body: string, rules = ""): string => page(body, { head: `<style>${TOKENS}\n${BASE}\n${rules}</style>` });

const SR_ONLY = "position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap";

const pages = {
  "index.html": styled(
    [
      "<h1>Contracts</h1>",
      "<p>Five years of practice.</p>",
      "<p>Deals closed on time.</p>",
      '<p style="display: none">Hidden note</p>',
      '<div style="opacity: 0">Faded note</div>',
      `<span style="${SR_ONLY}">Screen reader note</span>`,
    ].join(""),
  ),
  "drift.html": styled("<h1>Contracts</h1><p>Five years of practice.</p><p class=\"note\">Deals closed on time.</p>", ".note { line-height: var(--leading-title); }"),
  "unmatched.html": styled('<h1>Contracts</h1><p>Five years of practice.</p><div class="aside">Prices exclude tax.</div>'),
  "untokened.html": styled('<h1>Contracts</h1><p>Five years of practice.</p><div class="label">Since 2019</div>', ".label { letter-spacing: 0.1em; }"),
};

const ROLES = { title: ["h1"], label: [".label"], body: ["p"] };

test("look refuses a role drifting in line height from another page, text no role claims and a letter spacing no token declares, and passes the page held to its tokens", async () => {
  const site = await browserSite({
    ...sitePages(pages),
    "browser-checks.json": declaration({ routes: routesOf(pages), targets: [{ name: "headline", selector: "h1" }], checks: ["look"], roles: ROLES }),
  });
  const failed = await site.run();
  expect(failuresOf(failed.text)).toEqual([
    `${at("look", "/drift.html")} role body p.note "Deals closed on time." differs from p "Five years of practice." at /index.html in line-height 1.2, not 1.5`,
    `${at("look", "/unmatched.html")} div.aside "Prices exclude tax." matches no role`,
    `${at("look", "/untokened.html")} letter-spacing 0.1em of div.label "Since 2019" equals no declared token`,
  ]);
  expect(failed.text).toContain(`browser: ${at("look", "/index.html").slice(0, -1)} scanned title 1, body 2, 9 token(s)`);
  expect(failed.exitCode).toBe(1);
}, 120_000);

test("look judges text below a fixed panel fold instead of skipping it as parked", async () => {
  const site = await browserSite({
    "dist/index.html": styled("<h1>Contracts</h1><div class=\"panel\"><p>Top note.</p><div style=\"height: 1200px\"></div><p>Deep note.</p></div>", ".panel { height: 100vh; overflow-y: auto; overflow-x: hidden; }"),
    "browser-checks.json": declaration({ targets: [{ name: "headline", selector: "h1" }], checks: ["look"], roles: ROLES }),
  });
  const passed = await site.run();
  expect(failuresOf(passed.text)).toEqual([]);
  expect(passed.text).toContain(`scanned title 1, body 2, 9 token(s)`);
  expect(passed.exitCode).toBe(0);
}, 120_000);

test("look compares a role within one viewport, so body text a token enlarges on a wide screen is not drift", async () => {
  const site = await browserSite({
    "dist/index.html": styled("<h1>Contracts</h1><p>Five years of practice.</p>", "@media (width >= 600px) { :root { --text-body: 1.25rem; } }"),
    "browser-checks.json": declaration({
      viewports: [{ name: "phone", width: 320, height: 640 }, { name: "laptop", width: 1280, height: 800 }],
      targets: [{ name: "headline", selector: "h1" }],
      checks: ["look"],
      roles: ROLES,
    }),
  });
  const passed = await site.run();
  expect(failuresOf(passed.text)).toEqual([]);
  expect(passed.exitCode).toBe(0);
}, 120_000);

test("look runs only in the default state, so an enlarged-text visit adds no second run", async () => {
  const site = await browserSite({
    "dist/index.html": styled("<h1>Contracts</h1><p>Five years of practice.</p>"),
    "browser-checks.json": declaration({
      targets: [{ name: "headline", selector: "h1" }],
      checks: ["look"],
      roles: ROLES,
      states: [{ name: "default" }, { name: "enlarged text", textPx: 32 }],
    }),
  });
  const passed = await site.run();
  expect(failuresOf(passed.text)).toEqual([]);
  const looks = passed.text.split("\n").filter((line) => line.startsWith("browser: look"));
  expect(looks).toHaveLength(1);
  expect(looks[0]).toContain(", default scanned");
  expect(passed.exitCode).toBe(0);
}, 120_000);
