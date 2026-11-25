import { Effect, Schema } from "effect";
import type { ElementHandle, Page } from "playwright-core";
import type { Target } from "./declaration.ts";
import { compareCrops, decodeOutcome, type CropArgs } from "./keyboard-crops.ts";
import { cropPng } from "./keyboard-png.ts";
import {
  changedPaintBoxes,
  decodeRecall,
  decodeRingScans,
  elementPath,
  recall,
  remember,
  scanRings,
  RESOLVE_LEAF,
  type Box,
  type PageElement,
} from "./keyboard-page.ts";
import { attempt, BrowserFailure, load } from "./page.ts";

const FOCUS_RING_MARGIN_PX = 6;

// A focus trap would hold Tab on the page forever, so the walk gives up past this many stops.
const STOP_LIMIT = 500;

type KeyboardReport = {
  readonly found: readonly string[];
  readonly reached: ReadonlyMap<string, number>;
  readonly complete: boolean;
  readonly notMeasured: readonly string[];
};

const ScrollSchema = Schema.Struct({ x: Schema.Finite, y: Schema.Finite });
const SizeSchema = Schema.Struct({ width: Schema.Finite, height: Schema.Finite });
type Size = typeof SizeSchema.Type;

type Capture = "page" | "viewport";

type Baseline = {
  readonly shot: Buffer;
  readonly capture: Capture;
  readonly scroll: typeof ScrollSchema.Type;
};

type ReferenceStop = {
  readonly path: string;
  readonly capture: Capture | null;
};

const decodeScroll = Schema.decodeUnknownEffect(ScrollSchema);
const decodeSize = Schema.decodeUnknownEffect(SizeSchema);

const scrollPosition = Effect.fn("scrollPosition")(function* (page: Page) {
  const raw: unknown = yield* attempt("cannot read the scroll position", () => page.evaluate("({ x: window.scrollX, y: window.scrollY })"));
  return yield* decodeScroll(raw).pipe(Effect.mapError(() => new BrowserFailure({ message: "the page gave no scroll position" })));
});

const pageSize = Effect.fn("pageSize")(function* (page: Page) {
  const raw: unknown = yield* attempt("cannot measure the page", () => page.evaluate("({ width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight })"));
  return yield* decodeSize(raw).pipe(Effect.mapError(() => new BrowserFailure({ message: "the page gave no dimensions" })));
});

const baselineBeforeTab = Effect.fn("baselineBeforeTab")(function* (page: Page, capture: Capture) {
  const previous = yield* focusedLeaf(page);
  if (previous !== null) yield* attempt("cannot blur the previous element", () => previous.evaluate((element: PageElement) => element.blur()));
  yield* attempt("cannot wait for blur paint", () => page.evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))"));
  const scroll = yield* scrollPosition(page);
  const shot = yield* attempt("cannot capture the baseline before Tab", () => page.screenshot({ animations: "disabled", fullPage: capture === "page" }));
  return { shot, capture, scroll } satisfies Baseline;
});

const count = (page: Page, selector: string) => attempt("cannot query " + selector, () => page.locator(selector).count());

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

const focusedLeaf = Effect.fn("focusedLeaf")(function* (page: Page) {
  const raw = yield* attempt("cannot hold the focused element", () => page.evaluateHandle<PageElement>(RESOLVE_LEAF));
  const hasLeaf = yield* attempt("cannot read the focused element", () =>
    raw.evaluate((value: PageElement): boolean => value instanceof Object));
  if (!hasLeaf) return null;
  return raw.asElement();
});

const elementPosition = (leaf: ElementHandle<PageElement>) => attempt("cannot read the element positioning", () => leaf.evaluate((element: PageElement) => {
  let fixed = false;
  let sticky = false;
  for (let current: PageElement | null = element; current !== null; current = current.parentElement) {
    const value = current.ownerDocument.defaultView.getComputedStyle(current).position;
    fixed ||= value === "fixed";
    sticky ||= value === "sticky";
  }
  return { fixed, sticky };
}));

const readMark = Effect.fn("readMark")(function* (leaf: ElementHandle<PageElement>) {
  const marked: unknown = yield* attempt("cannot read the focused element", () => leaf.evaluate(recall));
  return yield* decodeRecall(marked).pipe(
    Effect.mapError(() => new BrowserFailure({ message: "the focused element gave no mark" })),
  );
});

export const focusVerdict = (scrolledSticky: boolean, differs: boolean): boolean | "unmeasured" =>
  scrolledSticky && differs ? "unmeasured" : differs;

const prepareCrops = Effect.fn("prepareCrops")(function* (
  page: Page,
  boxes: readonly Box[],
  baseline: Buffer | null,
  focused: Buffer,
  blurred: Buffer,
) {
  const scaleSource: unknown = yield* attempt("cannot read the pixel ratio", () => page.evaluate("window.devicePixelRatio || 1"));
  const scale = yield* Schema.decodeUnknownEffect(Schema.Finite)(scaleSource).pipe(
    Effect.mapError(() => new BrowserFailure({ message: "the page gave no pixel ratio" })),
  );
  return yield* attempt("cannot crop the captures", () => Promise.resolve({
    baseline: baseline === null ? null : cropPng(baseline, boxes, scale),
    focused: cropPng(focused, boxes, scale),
    blurred: cropPng(blurred, boxes, scale),
  } satisfies CropArgs));
});

const focusRingShows = Effect.fn("focusRingShows")(function* (page: Page, leaf: ElementHandle<PageElement>, baseline: Baseline) {
  const box = yield* attempt("cannot measure the focused element", () => leaf.boundingBox());
  if (box === null) return false;
  const screen = page.viewportSize();
  if (screen === null) return yield* new BrowserFailure({ message: "cannot read the viewport" });
  if (onScreen(box, screen) === null) return false;
  const focusedSource: unknown = yield* attempt("cannot read the focused element and its ancestors", () => leaf.evaluate(scanRings));
  const focusedRings = yield* decodeRingScans(focusedSource).pipe(
    Effect.mapError(() => new BrowserFailure({ message: "the focused element gave no ring scan" })),
  );
  const scroll = yield* scrollPosition(page);
  const position = yield* elementPosition(leaf);
  const scrolledSticky = position.sticky && (scroll.x !== baseline.scroll.x || scroll.y !== baseline.scroll.y);
  const viewport = baseline.capture === "viewport";
  const withFocus = yield* attempt("cannot capture the focused element", () => page.screenshot({ animations: "disabled", fullPage: !viewport }));
  yield* attempt("cannot blur the focused element", () => leaf.evaluate((element: PageElement) => element.blur()));
  const blurredSource: unknown = yield* attempt("cannot read the blurred element and its ancestors", () => leaf.evaluate(scanRings));
  const blurredRings = yield* decodeRingScans(blurredSource).pipe(
    Effect.mapError(() => new BrowserFailure({ message: "the blurred element gave no ring scan" })),
  );
  const regions = [box];
  for (const [index, focused] of focusedRings.entries()) {
    const blurred = blurredRings[index];
    if (blurred === undefined) break;
    regions.push(...changedPaintBoxes(focused, blurred));
  }
  const withoutFocus = yield* attempt("cannot capture the blurred element", () => page.screenshot({ animations: "disabled", fullPage: !viewport }));
  yield* attempt("cannot focus the element again", () => leaf.evaluate((element: PageElement) => element.focus({ preventScroll: true })));
  const dimensions = viewport ? screen : yield* pageSize(page);
  const boxes = regions.map((region) => cropTo(viewport ? region : { ...region, x: region.x + scroll.x, y: region.y + scroll.y }, dimensions)).filter((rect) => rect !== null);
  if (boxes.length === 0) return false;
  const crops = yield* prepareCrops(page, boxes, scrolledSticky ? null : baseline.shot, withFocus, withoutFocus);
  const comparedSource: unknown = yield* attempt("cannot compare the baseline, focused and blurred captures", () =>
    leaf.evaluate(compareCrops, crops));
  const outcome = yield* decodeOutcome(comparedSource).pipe(
    Effect.mapError(() => new BrowserFailure({ message: "the page gave no usable comparison" })),
  );
  if (!outcome.compared) return yield* new BrowserFailure({ message: "cannot read the capture" });
  return focusVerdict(scrolledSticky, outcome.differs);
});

const tabToNextStop = Effect.fn("tabToNextStop")(function* (page: Page) {
  yield* attempt("cannot press Tab", () => page.keyboard.press("Tab"));
  return (yield* count(page, ":focus")) > 0;
});

const pathOf = Effect.fn("pathOf")(function* (leaf: ElementHandle<PageElement>) {
  const raw: unknown = yield* attempt("cannot identify the focused element", () => leaf.evaluate(elementPath));
  return yield* decodeRecall(raw).pipe(Effect.mapError(() => new BrowserFailure({ message: "the focused element gave no path" })));
});

const referenceTabs = Effect.fn("referenceTabs")(function* (page: Page, targets: readonly Target[]) {
  yield* snapshotTargets(page, targets);
  const stops: ReferenceStop[] = [];
  while (stops.length < STOP_LIMIT && (yield* tabToNextStop(page))) {
    const leaf = yield* focusedLeaf(page);
    if (leaf === null) return yield* new BrowserFailure({ message: "cannot identify a Tab stop" });
    const path = yield* pathOf(leaf);
    if ((yield* readMark(leaf)) === "") {
      stops.push({ path, capture: null });
      continue;
    }
    const position = yield* elementPosition(leaf);
    stops.push({ path, capture: position.fixed || position.sticky ? "viewport" : "page" });
  }
  return stops;
});

type Snapshot = {
  readonly target: Target;
  readonly total: number;
  readonly seen: Set<string>;
};

const snapshotTargets = Effect.fn("snapshotTargets")(function* (page: Page, targets: readonly Target[]) {
  const snapshots: Snapshot[] = [];
  for (const [index, target] of targets.entries()) {
    const handles = yield* attempt("cannot query " + target.selector, () =>
      page.locator(target.selector).filter({ visible: true }).elementHandles());
    for (const [position, handle] of handles.entries()) {
      yield* attempt("cannot mark the visible element", () => handle.evaluate(remember, index + ":" + position));
    }
    snapshots.push({ target, total: handles.length, seen: new Set<string>() });
  }
  return snapshots;
});

const creditToken = (snapshots: readonly Snapshot[], token: string): Target | undefined => {
  const targetIndex = Number(token.slice(0, token.indexOf(":")));
  if (!Number.isInteger(targetIndex) || targetIndex < 0) return undefined;
  const snapshot = snapshots[targetIndex];
  if (snapshot === undefined) return undefined;
  snapshot.seen.add(token);
  return snapshot.target;
};

const hitTargets = (snapshots: readonly Snapshot[], id: string): Target[] => {
  const hit: Target[] = [];
  for (const token of id.split(" ").filter((part) => part !== "")) {
    const credited = creditToken(snapshots, token);
    if (credited === undefined) continue;
    if (!hit.includes(credited)) hit.push(credited);
  }
  return hit;
};

export const recordFocusVerdict = (names: string, visible: boolean | "unmeasured", found: string[], notMeasured: string[]): void => {
  if (visible === "unmeasured") notMeasured.push(names + ": Tab scrolled a sticky element, not measured");
  else if (!visible) found.push(names + " shows no visible focus when Tab reaches it");
};

const walkTabs = Effect.fn("walkTabs")(function* (page: Page, snapshots: readonly Snapshot[], reference: readonly ReferenceStop[]) {
  const found: string[] = [];
  const notMeasured: string[] = [];
  let complete = true;
  let stops = 0;
  while (true) {
    const expected = reference[stops];
    const baseline = expected?.capture == null ? null : yield* baselineBeforeTab(page, expected.capture);
    if (!(yield* tabToNextStop(page))) {
      complete = stops >= reference.length;
      break;
    }
    stops += 1;
    if (stops > STOP_LIMIT) {
      found.push("Tab never leaves the page within " + STOP_LIMIT + " stops");
      break;
    }
    const leaf = yield* focusedLeaf(page);
    if (leaf === null || (yield* pathOf(leaf)) !== expected?.path) {
      complete = false;
      break;
    }
    const id = yield* readMark(leaf);
    if ((id === "") !== (baseline === null)) {
      complete = false;
      break;
    }
    if (baseline === null) continue;
    const names = hitTargets(snapshots, id).map(({ name }) => name).join(" and ");
    const visible = yield* focusRingShows(page, leaf, baseline);
    recordFocusVerdict(names, visible, found, notMeasured);
  }
  return { found, complete, notMeasured };
});

const reportReach = (
  snapshots: readonly Snapshot[],
  complete: boolean,
): { readonly found: readonly string[]; readonly reached: ReadonlyMap<string, number> } => {
  const found: string[] = [];
  const reached = new Map<string, number>();
  for (const snapshot of snapshots) {
    if (snapshot.seen.size > 0) reached.set(snapshot.target.name, snapshot.seen.size);
    if (complete && snapshot.seen.size !== snapshot.total) {
      found.push("Tab reached " + snapshot.target.name + " " + snapshot.seen.size + " of " + snapshot.total + " time(s)");
    }
  }
  return { found, reached };
};

export const judgeKeyboard = Effect.fn("judgeKeyboard")(function* (page: Page, targets: readonly Target[]) {
  const url = page.url();
  const reference = yield* referenceTabs(page, targets);
  yield* attempt("cannot reset the page after the reference pass", () => page.goto("about:blank"));
  yield* load(page, url);
  const snapshots = yield* snapshotTargets(page, targets);
  const walked = yield* walkTabs(page, snapshots, reference);
  const reported = reportReach(snapshots, walked.complete);
  return { found: [...walked.found, ...reported.found], reached: reported.reached, complete: walked.complete, notMeasured: walked.notMeasured } satisfies KeyboardReport;
});
