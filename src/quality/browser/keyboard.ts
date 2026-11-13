import { Effect } from "effect";
import type { ElementHandle, Page } from "playwright-core";
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

type RingScan = { readonly box: Box; readonly paint: ReadonlyArray<string>; readonly grow: number };

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
    return Number.isFinite(parsed) ? parsed : undefined;
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
      const horizontal = made[0] ?? 0;
      const vertical = made[1] ?? 0;
      const blur = Math.max(0, made[2] ?? 0);
      const spread = made[3] ?? 0;
      extent = Math.max(extent, 0, horizontal + blur + spread, -horizontal + blur + spread, vertical + blur + spread, -vertical + blur + spread);
    }
    return extent;
  };
  const ringOut = (painted: CSSStyleDeclaration): number => {
    const outline = painted.outlineStyle === "none" ? 0 : Math.max(0, (len(painted.outlineWidth) ?? 0) + (len(painted.outlineOffset) ?? 0));
    return Math.max(outline, shadowOut(painted.boxShadow));
  };
  const ringPaint = (painted: CSSStyleDeclaration): ReadonlyArray<string> => [
    "outlineStyle=" + painted.outlineStyle,
    "outlineWidth=" + painted.outlineWidth,
    "outlineColor=" + painted.outlineColor,
    "outlineOffset=" + painted.outlineOffset,
    "boxShadow=" + painted.boxShadow,
    "borderTopWidth=" + painted.borderTopWidth,
    "borderTopStyle=" + painted.borderTopStyle,
    "borderTopColor=" + painted.borderTopColor,
    "borderRightWidth=" + painted.borderRightWidth,
    "borderRightStyle=" + painted.borderRightStyle,
    "borderRightColor=" + painted.borderRightColor,
    "borderBottomWidth=" + painted.borderBottomWidth,
    "borderBottomStyle=" + painted.borderBottomStyle,
    "borderBottomColor=" + painted.borderBottomColor,
    "borderLeftWidth=" + painted.borderLeftWidth,
    "borderLeftStyle=" + painted.borderLeftStyle,
    "borderLeftColor=" + painted.borderLeftColor,
    "backgroundColor=" + painted.backgroundColor,
    "backgroundImage=" + painted.backgroundImage,
  ];
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
      paint: [...ringPaint(self), ...ringPaint(before).map((entry) => "before:" + entry), ...ringPaint(after).map((entry) => "after:" + entry)],
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

const cropTo = (box: Box, screen: Size): Box | null => {
  const left = Math.max(0, box.x);
  const top = Math.max(0, box.y);
  const right = Math.min(screen.width, box.x + box.width);
  const bottom = Math.min(screen.height, box.y + box.height);
  if (right <= left || bottom <= top) return null;
  return { x: left, y: top, width: right - left, height: bottom - top };
};

const onScreen = (box: Box, screen: Size): Box | null => {
  const left = Math.max(0, box.x - FOCUS_RING_MARGIN_PX);
  const top = Math.max(0, box.y - FOCUS_RING_MARGIN_PX);
  const right = Math.min(screen.width, box.x + box.width + FOCUS_RING_MARGIN_PX);
  const bottom = Math.min(screen.height, box.y + box.height + FOCUS_RING_MARGIN_PX);
  if (right <= left || bottom <= top) return null;
  return { x: left, y: top, width: right - left, height: bottom - top };
};

const resolveLeaf = (): Element | null => {
  let leaf: Element | null = null;
  let scope: Document | ShadowRoot = document;
  while (scope.activeElement !== null && scope.activeElement !== leaf) {
    leaf = scope.activeElement;
    const inner = (leaf as unknown as { shadowRoot?: ShadowRoot | null }).shadowRoot;
    if (inner === undefined || inner === null) return leaf;
    scope = inner;
  }
  return leaf;
};

type CropArgs = { readonly first: string; readonly second: string; readonly x: number; readonly y: number; readonly width: number; readonly height: number };

const cropsDiffer = async (args: CropArgs): Promise<boolean> => {
  const scale = window.devicePixelRatio || 1;
  const left = Math.round(args.x * scale);
  const top = Math.round(args.y * scale);
  const width = Math.max(1, Math.round(args.width * scale));
  const height = Math.max(1, Math.round(args.height * scale));
  const decode = (raw: string): Promise<ImageBitmap> => {
    const binary = atob(raw);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return createImageBitmap(new Blob([bytes], { type: "image/png" }));
  };
  const pixels = (shot: ImageBitmap): Uint8ClampedArray => {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (context === null) throw new Error("cannot read the capture");
    context.drawImage(shot, left, top, width, height, 0, 0, width, height);
    return context.getImageData(0, 0, width, height).data;
  };
  const first = await decode(args.first);
  const a = pixels(first);
  first.close();
  const second = await decode(args.second);
  const b = pixels(second);
  second.close();
  if (a.length !== b.length) return true;
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) return true;
  }
  return false;
};

const remember = (el: Element, id: string): void => {
  const store = globalThis as unknown as { checksKb?: WeakMap<Element, string> };
  if (store.checksKb === undefined) store.checksKb = new WeakMap();
  const seen = store.checksKb.get(el);
  store.checksKb.set(el, seen === undefined ? id : seen + " " + id);
};

const recall = (el: Element): string => {
  const store = globalThis as unknown as { checksKb?: WeakMap<Element, string> };
  const seen = store.checksKb?.get(el);
  return seen ?? "";
};

const focusRingShows = Effect.fn("focusRingShows")(function* (page: Page) {
  const raw = yield* attempt("cannot hold the focused element", () => page.evaluateHandle(resolveLeaf));
  const leaf = raw.asElement();
  if (leaf === null) return false;
  const focused = leaf as ElementHandle<Element>;
  const box = yield* attempt("cannot measure the focused element", () => focused.boundingBox());
  if (box === null) return false;
  const screen = page.viewportSize();
  if (screen === null) return yield* new BrowserFailure({ message: "cannot read the viewport" });
  if (onScreen(box, screen) === null) return false;
  const focusedRings = yield* attempt("cannot read the focused element and its ancestors", () => focused.evaluate(scanRings));
  const withFocus = yield* attempt("cannot capture the focused element", () => page.screenshot({ animations: "disabled" }));
  yield* attempt("cannot blur the focused element", () => focused.evaluate((el: Element) => { el.blur(); }));
  const blurredRings = yield* attempt("cannot read the blurred element and its ancestors", () => focused.evaluate(scanRings));
  let region: Box = box;
  const depth = Math.min(focusedRings.length, blurredRings.length);
  for (let index = 0; index < depth; index += 1) {
    if (focusedRings[index].paint.join("\n") !== blurredRings[index].paint.join("\n")) {
      region = union(region, grown(focusedRings[index].box, focusedRings[index].grow));
      region = union(region, grown(blurredRings[index].box, blurredRings[index].grow));
    }
  }
  const rect = cropTo(region, screen);
  if (rect === null) return false;
  const withoutFocus = yield* attempt("cannot capture the blurred element", () => page.screenshot({ animations: "disabled" }));
  yield* attempt("cannot focus the element again", () => focused.focus());
  return yield* attempt("cannot compare the focused and blurred captures", () =>
    page.evaluate(cropsDiffer, {
      first: withFocus.toString("base64"),
      second: withoutFocus.toString("base64"),
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
    }));
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
    const raw = yield* attempt("cannot hold the focused element", () => page.evaluateHandle(resolveLeaf));
    const leaf = raw.asElement();
    if (leaf === null) continue;
    const focused = leaf as ElementHandle<Element>;
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
