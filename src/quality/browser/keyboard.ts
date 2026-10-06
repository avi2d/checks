import { Effect } from "effect";
import type { Page } from "playwright-core";
import type { Target } from "./declaration.ts";
import { attempt } from "./page.ts";

const FOCUS_RING_MARGIN_PX = 6;

// A focus trap would hold Tab on the page forever, so the walk gives up past this many stops.
const STOP_LIMIT = 500;

type KeyboardReport = {
  readonly found: readonly string[];
  readonly reached: ReadonlyMap<string, number>;
};

const count = (page: Page, selector: string) => attempt(`cannot query ${selector}`, () => page.locator(selector).count());

const focusedTargets = Effect.fn("focusedTargets")(function* (page: Page, targets: readonly Target[]) {
  const focused: Target[] = [];
  for (const target of targets) {
    const matches = yield* attempt(`cannot query ${target.selector}`, () => page.locator(target.selector).and(page.locator(":focus")).count());
    if (matches > 0) focused.push(target);
  }
  return focused;
});

const focusRingShows = Effect.fn("focusRingShows")(function* (page: Page) {
  const focused = yield* attempt("cannot hold the focused element", () => page.locator(":focus").elementHandle());
  const box = yield* attempt("cannot measure the focused element", () => focused.boundingBox());
  if (box === null) return false;
  const clip = {
    x: Math.max(0, box.x - FOCUS_RING_MARGIN_PX),
    y: Math.max(0, box.y - FOCUS_RING_MARGIN_PX),
    width: box.width + 2 * FOCUS_RING_MARGIN_PX,
    height: box.height + 2 * FOCUS_RING_MARGIN_PX,
  };
  const withFocus = yield* attempt("cannot capture the focused element", () => page.screenshot({ clip }));
  yield* attempt("cannot blur the focused element", () => page.evaluate("document.activeElement.blur()"));
  const withoutFocus = yield* attempt("cannot capture the blurred element", () => page.screenshot({ clip }));
  yield* attempt("cannot focus the element again", () => focused.focus());
  return !withFocus.equals(withoutFocus);
});

// Past the last stop Tab leaves the page for the browser, and the next press starts over at the first stop.
const tabToNextStop = Effect.fn("tabToNextStop")(function* (page: Page) {
  yield* attempt("cannot press Tab", () => page.keyboard.press("Tab"));
  return (yield* count(page, ":focus")) > 0;
});

export const judgeKeyboard = Effect.fn("judgeKeyboard")(function* (page: Page, targets: readonly Target[]) {
  const found: string[] = [];
  const reached = new Map<string, number>();
  let stops = 0;
  while (yield* tabToNextStop(page)) {
    stops += 1;
    if (stops > STOP_LIMIT) {
      found.push(`Tab never leaves the page within ${STOP_LIMIT} stops`);
      break;
    }
    const focused = yield* focusedTargets(page, targets);
    for (const target of focused) reached.set(target.name, (reached.get(target.name) ?? 0) + 1);
    if (focused.length > 0 && !(yield* focusRingShows(page))) {
      found.push(`${focused.map(({ name }) => name).join(" and ")} shows no visible focus when Tab reaches it`);
    }
  }
  for (const target of targets) {
    const present = yield* count(page, target.selector);
    if (present === 0) found.push(`${target.name} (${target.selector}) matches nothing`);
    if ((reached.get(target.name) ?? 0) !== present) found.push(`Tab reached ${target.name} ${reached.get(target.name) ?? 0} of ${present} time(s)`);
  }
  return { found, reached } satisfies KeyboardReport;
});
