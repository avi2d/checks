import { expect, test } from "bun:test";
import { at, browserSite, declaration, failuresOf, page } from "../e2e/lib/browser-site.ts";

const CLEAN_LINK = page(`<p><a href="/">Write to me</a></p>`);

test("every-page visits each built page the declaration never names, and an axe-only default motion state fails contrast only motion shows without running layout there", async () => {
  const FAINT_WHEN_MOVING = page(`<p class="note">Write to me at <a href="/">this address</a></p>`, {
    head: "<style>.note { color: #000; } @media (prefers-reduced-motion: no-preference) { .note { color: #aaa; } }</style>",
  });
  const site = await browserSite({
    "dist/index.html": CLEAN_LINK,
    "dist/about/index.html": FAINT_WHEN_MOVING,
    "dist/notes.html": CLEAN_LINK,
    "browser-checks.json": declaration({
      routes: [{ preset: "every-page", locale: "en" }],
      states: [{ name: "reduced motion", reducedMotion: "reduce" }, { name: "default motion", checks: ["axe"] }],
      checks: ["layout", "axe"],
    }),
  });
  const failed = await site.run();
  const failures = failuresOf(failed.text);
  expect(failures).toHaveLength(1);
  expect(failures[0]).toStartWith(`${at("axe", "/about/", "default motion")} color-contrast (serious): p`);
  expect(failed.text.split("\n").filter((line) => line.startsWith("browser: layout at ")).toSorted()).toEqual(
    ["/", "/about/", "/notes.html"].map((path) => `browser: ${at("layout", path, "reduced motion").slice(0, -1)} scanned link 1`).toSorted(),
  );
  expect(failed.exitCode).toBe(1);

  await site.write({ "dist/about/index.html": CLEAN_LINK, "dist/later.html": CLEAN_LINK });
  const passed = await site.run();
  expect(passed.text).toContain(`browser: ${at("axe", "/later.html", "default motion").slice(0, -1)} scanned`);
  expect(passed.text).toContain("browser: 20 check run(s) over 4 route(s), 1 viewport(s), 2 state(s) and 1 target(s) pass");
  expect(passed.exitCode).toBe(0);
}, 120_000);

test("html runs in the first state that runs it, rather than in none when the first state names its checks without html", async () => {
  const site = await browserSite({
    "dist/index.html": page(`<p><a href="/">Write to me</a></p><form><input type="text" name="name"><button type="submit">Send</button></form>`),
    "browser-checks.json": declaration({ states: [{ name: "default", checks: ["axe"] }, { name: "alt" }], checks: ["axe", "html"] }),
  });
  const failed = await site.run();
  const html = failuresOf(failed.text).filter((line) => line.startsWith("html at"));
  expect(html).toHaveLength(1);
  expect(html[0]).toStartWith(`${at("html", "/", "alt")} `);
  expect(html[0]).toContain("input-missing-label");
  expect(failed.exitCode).toBe(1);
}, 120_000);
