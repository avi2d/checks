import { Effect, Schema } from "effect";
import type { ElementHandle, Page } from "playwright-core";
import type { Target } from "./declaration.ts";
import { compareCrops, decodeOutcome, focusCrops } from "./keyboard-crops.ts";
import {
  changedPaintBoxes,
  decodeRecall,
  decodeRingScans,
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
};

const ScrollSchema = Schema.Struct({ x: Schema.Finite, y: Schema.Finite });
const SizeSchema = Schema.Struct({ width: Schema.Finite, height: Schema.Finite });
type Size = typeof SizeSchema.Type;

type Baseline = {
  readonly page: Buffer;
  readonly viewport: Buffer;
  readonly scroll: typeof ScrollSchema.Type;
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

const baselineBeforeTab = Effect.fn("baselineBeforeTab")(function* (page: Page) {
  yield* attempt("cannot blur the previous element", () => page.evaluate("document.activeElement?.blur()"));
  yield* attempt("cannot wait for blur paint", () => page.evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))"));
  const scroll = yield* scrollPosition(page);
  const viewport = yield* attempt("cannot capture the viewport before Tab", () => page.screenshot({ animations: "disabled" }));
  const shot = yield* attempt("cannot capture the page before Tab", () => page.screenshot({ animations: "disabled", fullPage: true }));
  return { page: shot, viewport, scroll } satisfies Baseline;
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
  const position = yield* attempt("cannot read the element positioning", () => leaf.evaluate((element: PageElement) => {
    let fixed = false;
    let sticky = false;
    for (let current: PageElement | null = element; current !== null; current = current.parentElement) {
      const value = current.ownerDocument.defaultView.getComputedStyle(current).position;
      fixed ||= value === "fixed";
      sticky ||= value === "sticky";
    }
    return { fixed, sticky };
  }));
  if (position.sticky && (scroll.x !== baseline.scroll.x || scroll.y !== baseline.scroll.y)) return "unmeasured" as const;
  const viewport = position.fixed || position.sticky;
  const withFocus = yield* attempt("cannot capture the focused element", () => page.screenshot({ animations: "disabled", fullPage: !viewport }));
  yield* attempt("cannot blur the focused element", () => leaf.evaluate((element: PageElement) => element.blur()));
  const blurredSource: unknown = yield* attempt("cannot read the blurred element and its ancestors", () => leaf.evaluate(scanRings));
  const blurredRings = yield* decodeRingScans(blurredSource).pipe(
    Effect.mapError(() => new BrowserFailure({ message: "the blurred element gave no ring scan" })),
  );
  const regions = [{ x: box.x - FOCUS_RING_MARGIN_PX, y: box.y - FOCUS_RING_MARGIN_PX, width: box.width + FOCUS_RING_MARGIN_PX * 2, height: box.height + FOCUS_RING_MARGIN_PX * 2 }];
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
  const comparedSource: unknown = yield* attempt("cannot compare the baseline and focused captures", () =>
    leaf.evaluate(compareCrops, focusCrops({
      baseline: (viewport ? baseline.viewport : baseline.page).toString("base64"),
      focused: withFocus.toString("base64"),
      blurred: withoutFocus.toString("base64"),
    }, boxes)));
  const outcome = yield* decodeOutcome(comparedSource).pipe(
    Effect.mapError(() => new BrowserFailure({ message: "the page gave no usable comparison" })),
  );
  if (!outcome.compared) return yield* new BrowserFailure({ message: "cannot read the capture" });
  return outcome.differs;
});

const tabToNextStop = Effect.fn("tabToNextStop")(function* (page: Page) {
  yield* attempt("cannot press Tab", () => page.keyboard.press("Tab"));
  return (yield* count(page, ":focus")) > 0;
});

const elementPath = Effect.fn("elementPath")(function* (leaf: ElementHandle<PageElement>) {
  const raw: unknown = yield* attempt("cannot identify the focused element", () => leaf.evaluate(`element => {
    const parts = [];
    let node = element;
    while (node) {
      const parent = node.parentElement;
      const siblings = parent ? parent.children : node.getRootNode().children;
      parts.push(node.localName + ':' + Array.prototype.indexOf.call(siblings, node));
      if (parent) node = parent;
      else {
        node = node.getRootNode().host || null;
        if (node) parts.push('shadow');
      }
    }
    return parts.reverse().join('/');
  }`));
  return yield* decodeRecall(raw).pipe(Effect.mapError(() => new BrowserFailure({ message: "the focused element gave no path" })));
});

const referenceTabs = Effect.fn("referenceTabs")(function* (page: Page) {
  const paths: string[] = [];
  while (paths.length < STOP_LIMIT && (yield* tabToNextStop(page))) {
    const leaf = yield* focusedLeaf(page);
    if (leaf === null) return yield* new BrowserFailure({ message: "cannot identify a Tab stop" });
    paths.push(yield* elementPath(leaf));
  }
  return paths;
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

const judgeStop = Effect.fn("judgeStop")(function* (page: Page, leaf: ElementHandle<PageElement>, hit: readonly Target[], baseline: Baseline) {
  if (hit.length === 0) return undefined;
  const visible = yield* focusRingShows(page, leaf, baseline);
  const names = hit.map(({ name }) => name).join(" and ");
  if (visible === "unmeasured") return names + " focus was not measured because Tab scrolled a sticky element";
  return visible ? undefined : names + " shows no visible focus when Tab reaches it";
});

const walkTabs = Effect.fn("walkTabs")(function* (page: Page, snapshots: readonly Snapshot[], reference: readonly string[]) {
  const found: string[] = [];
  let stops = 0;
  while (true) {
    const baseline = yield* baselineBeforeTab(page);
    if (!(yield* tabToNextStop(page))) {
      if (stops < reference.length) found.push("Tab order changed after the reference pass, so this and later stops were not measured");
      break;
    }
    stops += 1;
    if (stops > STOP_LIMIT) {
      found.push("Tab never leaves the page within " + STOP_LIMIT + " stops");
      break;
    }
    const leaf = yield* focusedLeaf(page);
    if (leaf === null) continue;
    if ((yield* elementPath(leaf)) !== reference[stops - 1]) {
      found.push("Tab order changed after the reference pass, so this and later stops were not measured");
      break;
    }
    const marked: unknown = yield* attempt("cannot read the focused element", () => leaf.evaluate(recall));
    const id = yield* decodeRecall(marked).pipe(
      Effect.mapError(() => new BrowserFailure({ message: "the focused element gave no mark" })),
    );
    const failure = yield* judgeStop(page, leaf, hitTargets(snapshots, id), baseline);
    if (failure !== undefined) found.push(failure);
  }
  return found;
});

const reportReach = (
  snapshots: readonly Snapshot[],
): { readonly found: readonly string[]; readonly reached: ReadonlyMap<string, number> } => {
  const found: string[] = [];
  const reached = new Map<string, number>();
  for (const snapshot of snapshots) {
    if (snapshot.seen.size > 0) reached.set(snapshot.target.name, snapshot.seen.size);
    if (snapshot.seen.size !== snapshot.total) {
      found.push("Tab reached " + snapshot.target.name + " " + snapshot.seen.size + " of " + snapshot.total + " time(s)");
    }
  }
  return { found, reached };
};

export const judgeKeyboard = Effect.fn("judgeKeyboard")(function* (page: Page, targets: readonly Target[]) {
  const url = page.url();
  const reference = yield* referenceTabs(page);
  yield* attempt("cannot reset the page after the reference pass", () => page.goto("about:blank"));
  yield* load(page, url);
  const snapshots = yield* snapshotTargets(page, targets);
  const walked = yield* walkTabs(page, snapshots, reference);
  const reported = reportReach(snapshots);
  return { found: [...walked, ...reported.found], reached: reported.reached } satisfies KeyboardReport;
});
