import { Effect } from "effect";
import type { Page } from "playwright-core";
import type { Target } from "./declaration.ts";
import { attempt, type BrowserFailure } from "./page.ts";

type TargetsReport = {
  readonly found: readonly string[];
  readonly visible: ReadonlyMap<string, number>;
};

export const countVisible = (page: Page, selector: string): Effect.Effect<number, BrowserFailure> =>
  attempt(`cannot query ${selector}`, () => page.locator(selector).filter({ visible: true }).count());

export const judgeTargets = Effect.fn("judgeTargets")(function* (page: Page, targets: readonly Target[]) {
  const found: string[] = [];
  const visible = new Map<string, number>();
  for (const target of targets) {
    const shown = yield* countVisible(page, target.selector);
    visible.set(target.name, shown);
    if (shown === 0) found.push(`${target.name} (${target.selector}) matches no visible element`);
  }
  return { found, visible } satisfies TargetsReport;
});
