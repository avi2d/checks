import { Effect, Schema } from "effect";
import type { BrowserContext, Page } from "playwright-core";
import type { Rect } from "./dom.ts";
import { attempt, BrowserFailure } from "./page.ts";

const CONTROLS = "a[href], button, summary, input, select, textarea";

const Landing = Schema.NullOr(Schema.Struct({ x: Schema.Finite, y: Schema.Finite }));

type ScrollAlignment = "nearest" | "center" | "start" | "end";

type PointerTarget = {
  readonly ownerDocument: { readonly documentElement: { readonly clientWidth: number; readonly clientHeight: number } };
  readonly scrollIntoView: (options: { readonly behavior: "instant"; readonly block: ScrollAlignment; readonly inline: ScrollAlignment }) => void;
  readonly getClientRects: () => Iterable<Rect>;
  readonly getRootNode: () => { readonly elementFromPoint: (x: number, y: number) => unknown };
};

// Playwright's hover retries until a timeout to give up on a control the pointer cannot reach, and a busy host outlasts any timeout on a control it can reach.
// The page runs this from its source text, so it must not reach anything outside its own body.
function pointerLanding(control: PointerTarget): typeof Landing.Type {
  const reachesControl = (hit: unknown): boolean => {
    let node: unknown = hit;
    while (node !== null && node !== undefined) {
      if (node === control) return true;
      const candidate = node as { readonly assignedSlot?: unknown; readonly parentNode?: unknown; readonly host?: unknown };
      if (candidate.assignedSlot !== undefined && candidate.assignedSlot !== null) {
        node = candidate.assignedSlot;
        continue;
      }
      if (candidate.parentNode !== undefined && candidate.parentNode !== null) {
        node = candidate.parentNode;
        continue;
      }
      if (candidate.host !== undefined && candidate.host !== null) {
        node = candidate.host;
        continue;
      }
      return false;
    }
    return false;
  };
  const alignments: readonly ScrollAlignment[] = ["nearest", "center", "start", "end"];
  for (const alignment of alignments) {
    control.scrollIntoView({ behavior: "instant", block: alignment, inline: alignment });
    const { clientWidth, clientHeight } = control.ownerDocument.documentElement;
    for (const rect of control.getClientRects()) {
      const left = Math.max(rect.left, 0);
      const right = Math.min(rect.right, clientWidth);
      const top = Math.max(rect.top, 0);
      const bottom = Math.min(rect.bottom, clientHeight);
      if (right - left < 1 || bottom - top < 1) continue;
      const x = (left + right) / 2;
      const y = (top + bottom) / 2;
      const hit = control.getRootNode().elementFromPoint(x, y);
      if (hit !== null && reachesControl(hit)) return { x, y };
    }
  }
  return null;
}

// A motion reset for reduced motion shortens animations to near zero rather than removing them, so one that ends within a frame never moves.
const FRAME_MS = 1000 / 60;

const MOTION_RECORDER = `(() => {
  const seen = new WeakSet();
  const started = [];
  const scan = () => {
    for (const animation of document.getAnimations()) {
      if (seen.has(animation)) continue;
      seen.add(animation);
      if ((animation.effect?.getComputedTiming().activeDuration ?? 0) <= ${FRAME_MS}) continue;
      started.push(animation.animationName ?? animation.transitionProperty ?? "a scripted animation");
    }
  };
  const everyFrame = () => {
    scan();
    requestAnimationFrame(everyFrame);
  };
  requestAnimationFrame(everyFrame);
  window.__takeStartedAnimations = () => {
    scan();
    return started.splice(0);
  };
})()`;

const decodeStarted = Schema.decodeUnknownEffect(Schema.Array(Schema.String));

const decodeLanding = Schema.decodeUnknownEffect(Landing);

export function recordMotion(context: BrowserContext): Promise<unknown> {
  return context.addInitScript(MOTION_RECORDER);
}

const takeStartedAnimations = Effect.fn("takeStartedAnimations")(function* (page: Page) {
  const started: unknown = yield* attempt("cannot read the motion recorder", () => page.evaluate("window.__takeStartedAnimations()"));
  return yield* decodeStarted(started).pipe(
    Effect.mapError(() => new BrowserFailure({ message: `the motion recorder gave ${String(started)}, so it did not run before the page opened` })),
  );
});

type StillnessReport = {
  readonly found: readonly string[];
  readonly controls: number;
  readonly unhovered: number;
};

export const judgeStillness = Effect.fn("judgeStillness")(function* (page: Page) {
  const found: string[] = [];
  const animatedDuring = Effect.fn("animatedDuring")(function* (moment: string) {
    const started = yield* takeStartedAnimations(page);
    if (started.length > 0) found.push(`${started.join(", ")} animated ${moment}`);
  });
  yield* animatedDuring("during load");
  const scrollBehavior: unknown = yield* attempt("cannot read the scroll behaviour", () => page.evaluate("getComputedStyle(document.documentElement).scrollBehavior"));
  if (scrollBehavior === "smooth") found.push("the page scrolls smoothly");
  const controls = page.locator(CONTROLS);
  const count = yield* attempt("cannot count the controls", () => controls.count());
  let judged = 0;
  let unhovered = 0;
  for (let index = 0; index < count; index += 1) {
    const control = controls.nth(index);
    if (!(yield* attempt(`cannot see control ${index + 1}`, () => control.isVisible()))) continue;
    judged += 1;
    const landing: unknown = yield* attempt(`cannot find where the pointer lands on control ${index + 1}`, () => control.evaluate(pointerLanding));
    const point = yield* decodeLanding(landing).pipe(
      Effect.mapError(() => new BrowserFailure({ message: `the pointer landing on control ${index + 1} gave ${JSON.stringify(landing)}` })),
    );
    if (point !== null) {
      yield* attempt(`cannot hover control ${index + 1}`, () => page.mouse.move(point.x, point.y));
      yield* animatedDuring(`on hovering control ${index + 1}`);
      yield* attempt("cannot move the pointer away", () => page.mouse.move(0, 0));
      yield* animatedDuring(`on leaving control ${index + 1}`);
    } else {
      unhovered += 1;
    }
    yield* attempt(`cannot focus control ${index + 1}`, () => control.focus());
    yield* animatedDuring(`on focusing control ${index + 1}`);
  }
  return { found, controls: judged, unhovered } satisfies StillnessReport;
});
