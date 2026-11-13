import { Effect } from "effect";
import type { Page } from "playwright-core";
import type { Target } from "./declaration.ts";
import { attempt, BrowserFailure } from "./page.ts";

const FOCUS_RING_MARGIN_PX = 6;

// A focus trap would hold Tab on the page forever, so the walk gives up past this many stops.
const STOP_LIMIT = 500;

type KeyboardReport = {
  readonly found: readonly string[];
  readonly reached: ReadonlyMap<string, number>;
};

const count = (page: Page, selector: string) => attempt("cannot query " + selector, () => page.locator(selector).count());

type Box = { readonly x: number; readonly y: number; readonly width: number; readonly height: number };

type Size = { readonly width: number; readonly height: number };

type RingScan = { readonly box: Box; readonly paint: string };

const scanPaint = (el: Element): RingScan[] => {
  const nodes: RingScan[] = [];
  let current: Element | null = el;
  while (current !== null) {
    const rect = current.getBoundingClientRect();
    const painted = getComputedStyle(current);
    nodes.push({
      box: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      paint: [painted.outlineStyle, painted.outlineWidth, painted.outlineColor, painted.outlineOffset, painted.boxShadow, painted.borderTopWidth, painted.borderTopStyle, painted.borderTopColor, painted.borderRightWidth, painted.borderRightStyle, painted.borderRightColor, painted.borderBottomWidth, painted.borderBottomStyle, painted.borderBottomColor, painted.borderLeftWidth, painted.borderLeftStyle, painted.borderLeftColor, painted.backgroundColor, painted.backgroundImage].join(" "),
    });
    current = current.parentElement;
  }
  return nodes;
};

const union = (first: Box, second: Box): Box => ({
  x: Math.min(first.x, second.x),
  y: Math.min(first.y, second.y),
  width: Math.max(first.x + first.width, second.x + second.width) - Math.min(first.x, second.x),
  height: Math.max(first.y + first.height, second.y + second.height) - Math.min(first.y, second.y),
});

const onScreen = (box: Box, screen: Size): Box | null => {
  const left = Math.max(0, box.x - FOCUS_RING_MARGIN_PX);
  const top = Math.max(0, box.y - FOCUS_RING_MARGIN_PX);
  const right = Math.min(screen.width, box.x + box.width + FOCUS_RING_MARGIN_PX);
  const bottom = Math.min(screen.height, box.y + box.height + FOCUS_RING_MARGIN_PX);
  if (right <= left || bottom <= top) return null;
  return { x: left, y: top, width: right - left, height: bottom - top };
};

const focusRingShows = Effect.fn("focusRingShows")(function* (page: Page) {
  const focused = yield* attempt("cannot hold the focused element", () => page.locator(":focus").elementHandle());
  if (focused === null) return false;
  const box = yield* attempt("cannot measure the focused element", () => focused.boundingBox());
  if (box === null) return false;
  const screen = page.viewportSize();
  if (screen === null) return yield* new BrowserFailure({ message: "cannot read the viewport" });
  if (onScreen(box, screen) === null) return false;
  const focusedPaint = yield* attempt("cannot read the focused element and its ancestors", () => focused.evaluate(scanPaint));
  yield* attempt("cannot blur the focused element", () => page.evaluate("document.activeElement.blur()"));
  const blurredPaint = yield* attempt("cannot read the blurred element and its ancestors", () => focused.evaluate(scanPaint));
  let region: Box = box;
  const depth = Math.min(focusedPaint.length, blurredPaint.length);
  for (let index = 0; index < depth; index += 1) {
    if (focusedPaint[index].paint !== blurredPaint[index].paint) region = union(region, focusedPaint[index].box);
  }
  const clip = onScreen(region, screen);
  if (clip === null) return false;
  const withoutFocus = yield* attempt("cannot capture the blurred element", () => page.screenshot({ clip, animations: "disabled" }));
  yield* attempt("cannot focus the element again", () => focused.focus());
  const withFocus = yield* attempt("cannot capture the focused element", () => page.screenshot({ clip, animations: "disabled" }));
  return !withFocus.equals(withoutFocus);
});

// Past the last stop Tab leaves the page for the browser, and the next press starts over at the first stop.
const tabToNextStop = Effect.fn("tabToNextStop")(function* (page: Page) {
  yield* attempt("cannot press Tab", () => page.keyboard.press("Tab"));
  return (yield* count(page, ":focus")) > 0;
});

export const judgeKeyboard = Effect.fn("judgeKeyboard")(function* (page: Page, targets: readonly Target[]) {
  const found: string[] = [];
  const snapshots: string[][] = [];
  for (let index = 0; index < targets.length; index += 1) {
    const handles = yield* attempt("cannot query " + targets[index].selector, () =>
      page.locator(targets[index].selector).filter({ visible: true }).elementHandles());
    const tokens: string[] = [];
    for (let position = 0; position < handles.length; position += 1) {
      const token = index + ":" + position;
      yield* attempt("cannot mark the visible element", () =>
        handles[position].evaluate((el: Element, id: string) => {
          const current = el.getAttribute("data-checks-kb");
          el.setAttribute("data-checks-kb", current === null || current === "" ? id : current + " " + id);
        }, token));
      tokens.push(token);
    }
    snapshots.push(tokens);
  }
  const reachedSets: Set<string>[] = snapshots.map(() => new Set<string>());
  let stops = 0;
  while (yield* tabToNextStop(page)) {
    stops += 1;
    if (stops > STOP_LIMIT) {
      found.push("Tab never leaves the page within " + STOP_LIMIT + " stops");
      break;
    }
    const focused = yield* attempt("cannot hold the focused element", () => page.locator(":focus").elementHandle());
    if (focused === null) continue;
    const marked = yield* attempt("cannot read the focused element", () => focused.evaluate((el: Element) => el.getAttribute("data-checks-kb") ?? ""));
    const hit: Target[] = [];
    for (const token of marked.split(" ").filter((part) => part !== "")) {
      const targetIndex = Number(token.slice(0, token.indexOf(":")));
      if (!Number.isInteger(targetIndex) || targetIndex < 0 || targetIndex >= targets.length) continue;
      reachedSets[targetIndex].add(token);
      if (!hit.includes(targets[targetIndex])) hit.push(targets[targetIndex]);
    }
    if (hit.length > 0 && !(yield* focusRingShows(page))) {
      found.push(hit.map(({ name }) => name).join(" and ") + " shows no visible focus when Tab reaches it");
    }
  }
  const reached = new Map<string, number>();
  for (let index = 0; index < targets.length; index += 1) {
    if (reachedSets[index].size > 0) reached.set(targets[index].name, reachedSets[index].size);
    if (reachedSets[index].size !== snapshots[index].length) found.push("Tab reached " + targets[index].name + " " + reachedSets[index].size + " of " + snapshots[index].length + " time(s)");
  }
  return { found, reached } satisfies KeyboardReport;
});

