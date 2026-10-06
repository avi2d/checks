import { Effect, Schema } from "effect";
import type { BrowserContext, Page } from "playwright-core";
import { attempt, BrowserFailure } from "./page.ts";

const CONTROLS = "a[href], button, summary, input, select, textarea";

const MOTION_RECORDER = `(() => {
  const seen = new WeakSet();
  const started = [];
  const scan = () => {
    for (const animation of document.getAnimations()) {
      if (seen.has(animation)) continue;
      seen.add(animation);
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
  for (let index = 0; index < count; index += 1) {
    const control = controls.nth(index);
    if (!(yield* attempt(`cannot see control ${index + 1}`, () => control.isVisible()))) continue;
    judged += 1;
    yield* attempt(`cannot hover control ${index + 1}`, () => control.hover());
    yield* animatedDuring(`on hovering control ${index + 1}`);
    yield* attempt("cannot move the pointer away", () => page.mouse.move(0, 0));
    yield* animatedDuring(`on leaving control ${index + 1}`);
    yield* attempt(`cannot focus control ${index + 1}`, () => control.focus());
    yield* animatedDuring(`on focusing control ${index + 1}`);
  }
  return { found, controls: judged } satisfies StillnessReport;
});
