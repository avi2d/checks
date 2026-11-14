import { expect, test } from "bun:test";
import { at, browserSite, declaration, failuresOf, page } from "../e2e/lib/browser-site.ts";

const HEADLINE = { name: "headline", selector: "h1" };

const FADE = "<style>@keyframes enter { from { opacity: 0 } to { opacity: 1 } }</style>";

const fading = (color: string): string => page(`<h1 style="color:${color};animation:enter 4s linear both">Contracts</h1>`, { head: FADE });

const CONTRAST_FAILURE = "color-contrast (serious): h1: Elements must meet minimum color contrast ratio thresholds";

test("axe reads a headline after its entrance plays out, not at its faded first frame, and still fails it once settled at a low contrast", async () => {
  const faded = await browserSite({
    "dist/index.html": fading("#000"),
    "browser-checks.json": declaration({ targets: [HEADLINE], checks: ["axe"] }),
  });
  const passed = await faded.run();
  expect(failuresOf(passed.text)).toEqual([]);
  expect(passed.exitCode).toBe(0);

  const low = await browserSite({
    "dist/index.html": fading("#999"),
    "browser-checks.json": declaration({ targets: [HEADLINE], checks: ["axe"] }),
  });
  const failed = await low.run();
  expect(failuresOf(failed.text)).toEqual([`${at("axe", "/")} ${CONTRAST_FAILURE}`]);
  expect(failed.exitCode).toBe(1);
}, 120_000);
