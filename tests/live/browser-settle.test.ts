import { expect, test } from "bun:test";
import { Effect } from "effect";
import { chromium } from "playwright-core";
import { settle } from "../../src/quality/browser/page.ts";

// The fade's keyframes end at full opacity, so a heading read after settle returns must be at 1.
const FADING = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Fixture</title><style>h1{color:#000;opacity:0}h1.in{animation:enter 4s linear both}@keyframes enter{from{opacity:0}to{opacity:1}}</style></head><body><main><h1 class="fade">Contracts</h1></main></body></html>`;

test("settle does not return before a fade that starts just after it begins has finished", async () => {
  const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: "chrome" });
  try {
    const page = await (await browser.newContext()).newPage();
    await page.setContent(FADING);
    await page.evaluate(`setTimeout(() => document.querySelector(".fade")?.classList.add("in"), 100)`);
    await Effect.runPromise(settle(page));
    const opacity = await page.evaluate(`Number(getComputedStyle(document.querySelector(".fade")).opacity)`);
    expect(opacity).toBe(1);
  } finally {
    await browser.close();
  }
}, 120_000);
