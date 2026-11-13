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

type RingScan = { readonly box: Box; readonly paint: string; readonly grow: number };

const scanRings = (el: Element): RingScan[] => {
  const len = (token: string | undefined): number | undefined => {
    if (token === undefined) return undefined;
    if (token === "thin") return 1;
    if (token === "medium") return 3;
    if (token === "thick") return 5;
    if (token === "0") return 0;
    const made = /^(-?[\d.]+)px$/.exec(token);
    if (made === null) return undefined;
    const parsed = parseFloat(made[1]);
    return Number.isFinite(parsed) ? Math.max(0, parsed) : undefined;
  };
  const split = (value: string): string[] => {
    const tokens: string[] = [];
    let depth = 0;
    let token = "";
    for (const ch of value) {
      if (ch === "(") depth += 1;
      if (ch === ")") depth -= 1;
      if ((ch === " " || ch === "," || ch === "\t") && depth === 0) {
        if (token !== "") { tokens.push(token); token = ""; }
      } else { token += ch; }
    }
    if (token !== "") tokens.push(token);
    return tokens;
  };
  const shadowOut = (value: string): number => {
    if (value === "" || value === "none") return 0;
    const shadows: string[] = [];
    let depth = 0;
    let part = "";
    for (const ch of value) {
      if (ch === "(") depth += 1;
      if (ch === ")") depth -= 1;
      if (ch === "," && depth === 0) { shadows.push(part); part = ""; } else { part += ch; }
    }
    shadows.push(part);
    let extent = 0;
    for (const item of shadows) {
      const tokens = split(item);
      if (tokens.indexOf("inset") !== -1) continue;
      const made: number[] = [];
      for (const token of tokens) {
        const parsed = len(token);
        if (parsed !== undefined) made.push(parsed);
      }
      extent = Math.max(extent, (made[0] ?? 0) + (made[1] ?? 0) + (made[2] ?? 0) + (made[3] ?? 0));
    }
    return extent;
  };
  const ringOut = (painted: CSSStyleDeclaration): number => {
    const outline = painted.outlineStyle === "none" ? 0 : (len(painted.outlineWidth) ?? 0) + (len(painted.outlineOffset) ?? 0);
    return Math.max(outline, shadowOut(painted.boxShadow));
  };
  const ringPaint = (painted: CSSStyleDeclaration): string => [painted.outlineStyle, painted.outlineWidth, painted.outlineColor, painted.outlineOffset, painted.boxShadow, painted.borderTopWidth, painted.borderTopStyle, painted.borderTopColor, painted.borderRightWidth, painted.borderRightStyle, painted.borderRightColor, painted.borderBottomWidth, painted.borderBottomStyle, painted.borderBottomColor, painted.borderLeftWidth, painted.borderLeftStyle, painted.borderLeftColor, painted.backgroundColor, painted.backgroundImage].join(" ");
  const nodes: RingScan[] = [];
  let current: Element | null = el;
  while (current !== null) {
    const rect = current.getBoundingClientRect();
    const self = getComputedStyle(current);
    const before = getComputedStyle(current, "::before");
    const after = getComputedStyle(current, "::after");
    let grow = ringOut(self);
    if (before.content !== "none" && before.content !== "normal") grow = Math.max(grow, ringOut(before));
    if (after.content !== "none" && after.content !== "normal") grow = Math.max(grow, ringOut(after));
    nodes.push({
      box: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      paint: [ringPaint(self), ringPaint(before), ringPaint(after)].join(" | "),
      grow,
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

const grown = (box: Box, margin: number): Box => ({
  x: box.x - margin,
  y: box.y - margin,
  width: box.width + margin * 2,
  height: box.height + margin * 2,
});

const covers = (outer: Box, inner: Box): boolean =>
  outer.x <= inner.x && outer.y <= inner.y && outer.x + outer.width >= inner.x + inner.width && outer.y + outer.height >= inner.y + inner.height;

const onScreen = (box: Box, screen: Size): Box | null => {
  const left = Math.max(0, box.x - FOCUS_RING_MARGIN_PX);
  const top = Math.max(0, box.y - FOCUS_RING_MARGIN_PX);
  const right = Math.min(screen.width, box.x + box.width + FOCUS_RING_MARGIN_PX);
  const bottom = Math.min(screen.height, box.y + box.height + FOCUS_RING_MARGIN_PX);
  if (right <= left || bottom <= top) return null;
  return { x: left, y: top, width: right - left, height: bottom - top };
};

const remember = (el: Element, id: string): void => {
  const store = globalThis as unknown as { __checksKb?: WeakMap<Element, string> };
  if (store.__checksKb === undefined) store.__checksKb = new WeakMap();
  const seen = store.__checksKb.get(el);
  store.__checksKb.set(el, seen === undefined ? id : seen + " " + id);
};

const recall = (el: Element): string => {
  const store = globalThis as unknown as { __checksKb?: WeakMap<Element, string> };
  const seen = store.__checksKb?.get(el);
  return seen ?? "";
};

const focusRingShows = Effect.fn("focusRingShows")(function* (page: Page) {
  const focused = yield* attempt("cannot hold the focused element", () => page.locator(":focus").elementHandle());
  if (focused === null) return false;
  const box = yield* attempt("cannot measure the focused element", () => focused.boundingBox());
  if (box === null) return false;
  const screen = page.viewportSize();
  if (screen === null) return yield* new BrowserFailure({ message: "cannot read the viewport" });
  if (onScreen(box, screen) === null) return false;
  const focusedRings = yield* attempt("cannot read the focused element and its ancestors", () => focused.evaluate(scanRings));
  let capture: Box = box;
  for (const node of focusedRings) {
    if (node.grow > 0) capture = union(capture, grown(node.box, node.grow));
  }
  const clip = onScreen(capture, screen);
  if (clip === null) return false;
  const withFocus = yield* attempt("cannot capture the focused element", () => page.screenshot({ clip, animations: "disabled" }));
  yield* attempt("cannot blur the focused element", () => page.evaluate("document.activeElement.blur()"));
  const blurredRings = yield* attempt("cannot read the blurred element and its ancestors", () => focused.evaluate(scanRings));
  let region: Box = box;
  const depth = Math.min(focusedRings.length, blurredRings.length);
  for (let index = 0; index < depth; index += 1) {
    if (focusedRings[index].paint !== blurredRings[index].paint) {
      region = union(region, grown(focusedRings[index].box, focusedRings[index].grow));
      region = union(region, grown(blurredRings[index].box, blurredRings[index].grow));
    }
  }
  if (!covers(capture, region)) {
    const wide = onScreen(region, screen);
    if (wide === null) return false;
    const blurredWide = yield* attempt("cannot capture the blurred element", () => page.screenshot({ clip: wide, animations: "disabled" }));
    yield* attempt("cannot focus the element again", () => focused.focus());
    const focusedWide = yield* attempt("cannot capture the focused element", () => page.screenshot({ clip: wide, animations: "disabled" }));
    return !focusedWide.equals(blurredWide);
  }
  const withoutFocus = yield* attempt("cannot capture the blurred element", () => page.screenshot({ clip, animations: "disabled" }));
  yield* attempt("cannot focus the element again", () => focused.focus());
  let explained = depth > 0 && focusedRings[0].paint !== blurredRings[0].paint;
  for (let index = 1; index < depth && !explained; index += 1) {
    if (focusedRings[index].grow > 0 && focusedRings[index].paint !== blurredRings[index].paint) explained = true;
  }
  if (!explained) return false;
  return !withFocus.equals(withoutFocus);
});

// Past the last stop Tab leaves the page for the browser, and the next press starts over at the first stop.
const tabToNextStop = Effect.fn("tabToNextStop")(function* (page: Page) {
  yield* attempt("cannot press Tab", () => page.keyboard.press("Tab"));
  return (yield* count(page, ":focus")) > 0;
});

export const judgeKeyboard = Effect.fn("judgeKeyboard")(function* (page: Page, targets: readonly Target[]) {
  const found: string[] = [];
  const snapshots: number[] = [];
  for (let index = 0; index < targets.length; index += 1) {
    const handles = yield* attempt("cannot query " + targets[index].selector, () =>
      page.locator(targets[index].selector).filter({ visible: true }).elementHandles());
    for (let position = 0; position < handles.length; position += 1) {
      yield* attempt("cannot mark the visible element", () => handles[position].evaluate(remember, index + ":" + position));
    }
    snapshots.push(handles.length);
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
    const marked = yield* attempt("cannot read the focused element", () => focused.evaluate(recall));
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
    if (reachedSets[index].size !== snapshots[index]) found.push("Tab reached " + targets[index].name + " " + reachedSets[index].size + " of " + snapshots[index] + " time(s)");
  }
  return { found, reached } satisfies KeyboardReport;
});
