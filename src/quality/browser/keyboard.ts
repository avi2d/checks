import { Effect } from "effect";
import type { Page } from "playwright-core";
import type { Target } from "./declaration.ts";
import {
  blurs,
  compareCrops,
  decodeOutcome,
  decodeRecall,
  decodeRingScans,
  recall,
  remember,
  reachOf,
  RESOLVE_LEAF,
  scanRings,
  union,
  type Box,
  type CropArgs,
  type PageElement,
} from "./keyboard-page.ts";
import { attempt, BrowserFailure } from "./page.ts";

const FOCUS_RING_MARGIN_PX = 6;

// A focus trap would hold Tab on the page forever, so the walk gives up past this many stops.
const STOP_LIMIT = 500;

type KeyboardReport = {
  readonly found: readonly string[];
  readonly reached: ReadonlyMap<string, number>;
};

type Size = { readonly width: number; readonly height: number };

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

const focusRingShows = Effect.fn("focusRingShows")(function* (page: Page) {
  const leaf = yield* focusedLeaf(page);
  if (leaf === null) return false;
  const box = yield* attempt("cannot measure the focused element", () => leaf.boundingBox());
  if (box === null) return false;
  const screen = page.viewportSize();
  if (screen === null) return yield* new BrowserFailure({ message: "cannot read the viewport" });
  if (onScreen(box, screen) === null) return false;
  const focusedSource: unknown = yield* attempt("cannot read the focused element and its ancestors", () => leaf.evaluate(scanRings));
  const focusedRings = yield* decodeRingScans(focusedSource).pipe(
    Effect.mapError(() => new BrowserFailure({ message: "the focused element gave no ring scan" })),
  );
  const withFocus = yield* attempt("cannot capture the focused element", () => page.screenshot({ animations: "disabled" }));
  yield* attempt("cannot blur the focused element", () => leaf.evaluate(blurs));
  const blurredSource: unknown = yield* attempt("cannot read the blurred element and its ancestors", () => leaf.evaluate(scanRings));
  const blurredRings = yield* decodeRingScans(blurredSource).pipe(
    Effect.mapError(() => new BrowserFailure({ message: "the blurred element gave no ring scan" })),
  );
  let region: Box = box;
  for (const [index, focused] of focusedRings.entries()) {
    const blurred = blurredRings[index];
    if (blurred === undefined) break;
    if (focused.paint.join("\n") !== blurred.paint.join("\n")) {
      region = union(reachOf(focused, region), reachOf(blurred, region));
    }
  }
  const rect = cropTo(region, screen);
  if (rect === null) return false;
  const withoutFocus = yield* attempt("cannot capture the blurred element", () => page.screenshot({ animations: "disabled" }));
  yield* attempt("cannot focus the element again", () => leaf.focus());
  const comparedSource: unknown = yield* attempt("cannot compare the focused and blurred captures", () =>
    leaf.evaluate(compareCrops, {
      first: withFocus.toString("base64"),
      second: withoutFocus.toString("base64"),
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
    } satisfies CropArgs));
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

const walkTabs = Effect.fn("walkTabs")(function* (page: Page, snapshots: readonly Snapshot[]) {
  const found: string[] = [];
  let stops = 0;
  while (yield* tabToNextStop(page)) {
    stops += 1;
    if (stops > STOP_LIMIT) {
      found.push("Tab never leaves the page within " + STOP_LIMIT + " stops");
      break;
    }
    const leaf = yield* focusedLeaf(page);
    if (leaf === null) continue;
    const marked: unknown = yield* attempt("cannot read the focused element", () => leaf.evaluate(recall));
    const id = yield* decodeRecall(marked).pipe(
      Effect.mapError(() => new BrowserFailure({ message: "the focused element gave no mark" })),
    );
    const hit = hitTargets(snapshots, id);
    if (hit.length > 0 && !(yield* focusRingShows(page))) {
      found.push(hit.map(({ name }) => name).join(" and ") + " shows no visible focus when Tab reaches it");
    }
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
  const snapshots = yield* snapshotTargets(page, targets);
  const walked = yield* walkTabs(page, snapshots);
  const reported = reportReach(snapshots);
  return { found: [...walked, ...reported.found], reached: reported.reached } satisfies KeyboardReport;
});
