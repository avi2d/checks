import { Effect } from "effect";
import type { Page } from "playwright-core";
import type { Target } from "./declaration.ts";
import { attempt, BrowserFailure } from "./page.ts";
import { countVisible } from "./targets.ts";

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

type Box = { readonly x: number; readonly y: number; readonly width: number; readonly height: number };

type Size = { readonly width: number; readonly height: number };

const ringCanShow = (box: Box, screen: Size): boolean =>
  box.x + box.width + FOCUS_RING_MARGIN_PX > 0 &&
  box.y + box.height + FOCUS_RING_MARGIN_PX > 0 &&
  box.x - FOCUS_RING_MARGIN_PX < screen.width &&
  box.y - FOCUS_RING_MARGIN_PX < screen.height;

// The whole viewport is compared, not a margin around the element, because an ancestor such as a row may draw the ring any distance outside it.
const capture = (page: Page) => page.screenshot({ animations: "disabled" });

const focusRingShows = Effect.fn("focusRingShows")(function* (page: Page) {
  const focused = yield* attempt("cannot hold the focused element", () => page.locator(":focus").elementHandle());
  const box = yield* attempt("cannot measure the focused element", () => focused.boundingBox());
  if (box === null) return false;
  const screen = page.viewportSize();
  if (screen === null) return yield* new BrowserFailure({ message: "cannot read the viewport" });
  if (!ringCanShow(box, screen)) return false;
  const withFocus = yield* attempt("cannot capture the focused element", () => capture(page));
  yield* attempt("cannot blur the focused element", () => page.evaluate("document.activeElement.blur()"));
  const withoutFocus = yield* attempt("cannot capture the blurred element", () => capture(page));
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
  const visibleAtVisit = new Map<string, number>();
  for (const target of targets) visibleAtVisit.set(target.name, yield* countVisible(page, target.selector));
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
  for (const [name, present] of visibleAtVisit) {
    const times = reached.get(name) ?? 0;
    if (times !== present) found.push(`Tab reached ${name} ${times} of ${present} time(s)`);
  }
  return { found, reached } satisfies KeyboardReport;
});
