import { Config, Console, Effect } from "effect";
import { pathsSinceMergeBase } from "../../core/git.ts";
import { scopeOfChanges } from "../../core/pull-request-scope.ts";
import { testEnvironmentReason, TEST_FILE } from "../../core/test-impact.ts";
import { readRouteImpact } from "../../quality/browser/route-scope.ts";
import { optionalInput } from "./lib/inputs.ts";
import { writeOutputs } from "./lib/step-output.ts";

const ORDINARY_TEST = /^tests\/(?:unit|e2e)\//;

export function testsOnly(changed: readonly string[]): boolean {
  return changed.length > 0 && changed.every((path) => ORDINARY_TEST.test(path) && TEST_FILE.test(path) && testEnvironmentReason(path) === undefined);
}

const browserNeeded = Effect.fn("browserNeeded")(function* (changed: readonly string[], docsOnly: boolean) {
  if (docsOnly) {
    for (const path of changed) yield* Console.log(`changes: ${path} -> no browser route`);
    return false;
  }
  const impact = yield* readRouteImpact(process.cwd(), changed);
  if (impact.kind === "full") {
    yield* Console.log(`changes: ${impact.because}, so the browser walks every route`);
    return true;
  }
  let reachable = false;
  for (const [file, routes] of impact.byChange) {
    yield* Console.log(`changes: ${file} -> ${routes.length === 0 ? "no browser route" : routes.join(", ")}`);
    if (routes.length > 0) reachable = true;
  }
  return reachable;
});

const keepFullRun = Effect.fn("keepFullRun")(function* (reason: string, planBrowser: boolean) {
  yield* Console.log(`changes: ${reason}, so the full run stays`);
  yield* writeOutputs({ "docs-only": "false", "tests-only": "false", ...(planBrowser ? { browser: "true" } : {}) });
  return true;
});

export const main = Effect.gen(function* () {
  const base = yield* optionalInput("BASE_SHA");
  const planBrowser = yield* Config.Boolean("PLAN_BROWSER").pipe(Config.withDefault(false));
  if (base === "") return yield* keepFullRun("no base commit", planBrowser);
  const changed = yield* pathsSinceMergeBase(base, "HEAD").pipe(
    Effect.catchTag("GitFailure", (cause) => Console.log(`changes: ${cause.message}`).pipe(Effect.as(undefined))),
  );
  if (changed === undefined) return yield* keepFullRun("the pull request's changes cannot be read", planBrowser);
  const docsOnly = scopeOfChanges("", changed).kind === "docs-only";
  const onlyTests = !docsOnly && testsOnly(changed);
  yield* Console.log(`changes: ${changed.length} changed file(s), docs-only=${docsOnly}, tests-only=${onlyTests}`);
  const browser = planBrowser ? yield* browserNeeded(changed, docsOnly) : undefined;
  yield* writeOutputs({ "docs-only": String(docsOnly), "tests-only": String(onlyTests), ...(browser === undefined ? {} : { browser: String(browser) }) });
  return true;
});
