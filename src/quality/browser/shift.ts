import { Effect, Schema } from "effect";
import type { BrowserContext, Page } from "playwright-core";
import type { ShiftBound } from "./declaration.ts";
import { attempt, BrowserFailure } from "./page.ts";

const RECORDER = `(() => {
  window.__coldShifts = [];
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      if (!("hadRecentInput" in entry && "value" in entry)) continue;
      const { hadRecentInput, value } = entry;
      if (!hadRecentInput && typeof value === "number") window.__coldShifts.push(value);
    }
  }).observe({ type: "layout-shift", buffered: true });
})()`;

const IMAGE_LIMIT_MS = 10_000;

const COLD_IMAGES = `Promise.race([
  Promise.all([...document.images].filter((image) => {
    if (image.getClientRects().length === 0) return false;
    if (image.loading !== "lazy") return true;
    for (const rect of image.getClientRects()) {
      if (rect.bottom > 0 && rect.top < window.innerHeight && rect.right > 0 && rect.left < window.innerWidth) return true;
    }
    return false;
  }).map((image) => image.decode().catch(() => undefined))),
  new Promise((_, reject) => setTimeout(() => reject(new Error("timed out")), ${IMAGE_LIMIT_MS})),
]).then(() => undefined)`;

const TWO_FRAMES = "new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(undefined))))";

const decodeShifts = Schema.decodeUnknownEffect(Schema.Array(Schema.Finite));

export function recordShifts(context: BrowserContext): Promise<unknown> {
  return context.addInitScript(RECORDER);
}

const settled = Effect.fn("settled")(function* (page: Page, url: string) {
  yield* attempt(`cannot settle ${url} to network idle`, () => page.waitForLoadState("networkidle"));
  yield* attempt(`images never render on ${url}`, () => page.evaluate(COLD_IMAGES));
  yield* attempt(`cannot settle a frame on ${url}`, () => page.evaluate(TWO_FRAMES));
});

export const coldShift = Effect.fn("coldShift")(function* (page: Page, url: string) {
  yield* settled(page, url);
  const shifts: unknown = yield* attempt(`cannot read the shift recorder on ${url}`, () => page.evaluate("window.__coldShifts"));
  const values = yield* decodeShifts(shifts).pipe(
    Effect.mapError(() => new BrowserFailure({ message: `the shift recorder never ran on ${url}, so no cold load was measured` })),
  );
  return values.reduce((total, value) => total + value, 0);
});

export function formatShift(total: number): string {
  return total.toFixed(3);
}

export function judgeShift(bound: ShiftBound, total: number): readonly string[] {
  return total > bound.max ? [`the cold load shifts ${formatShift(total)}, over the ${bound.max} bound`] : [];
}
