#!/usr/bin/env bun
import { Console, Effect, Path } from "effect";
import type { Browser } from "playwright-core";
import { runMain } from "../../core/main.ts";
import { watchAssets } from "./assets.ts";
import { judgeAxe } from "./axe.ts";
import { readDeclaration, targetsOn, visitsOf, type CheckName, type Declaration, type Visit } from "./declaration.ts";
import { loadHooks, runHook, type ProductCheck } from "./hooks.ts";
import { judgeKeyboard } from "./keyboard.ts";
import { judgeLayout } from "./layout.ts";
import { judgeStillness, recordMotion } from "./motion.ts";
import { judgeNesting } from "./nesting.ts";
import { attempt, launchChrome, load, openVisit, type BrowserFailure } from "./page.ts";
import { counted, NAME, passes, report, type Run } from "./report.ts";
import { readSite, serveSite } from "./serve.ts";

const NO_TARGET = "scanned no target";

type Visiting = {
  readonly browser: Browser;
  readonly declaration: Declaration;
  readonly visit: Visit;
  readonly url: string;
};

const run = (check: string, visit: Visit, inventory: readonly string[], found: readonly string[], unverified: readonly string[] = []): Run => ({
  check,
  visit,
  inventory,
  found,
  unverified,
});

const layoutRun = Effect.fn("layoutRun")(function* ({ browser, declaration, visit, url }: Visiting) {
  const { cdp, page } = yield* openVisit(browser, visit);
  yield* load(page, url);
  const { found, scanned } = yield* judgeLayout(cdp, targetsOn(declaration, visit.route.path));
  return run("layout", visit, counted(scanned.map(({ name }) => name)), scanned.length === 0 ? [...found, NO_TARGET] : found);
}, Effect.scoped);

const keyboardRun = Effect.fn("keyboardRun")(function* ({ browser, declaration, visit, url }: Visiting) {
  const targets = targetsOn(declaration, visit.route.path).filter(({ focusable }) => focusable === true);
  const { page } = yield* openVisit(browser, visit);
  yield* load(page, url);
  const { found, reached } = yield* judgeKeyboard(page, targets);
  const inventory = [...reached].map(([name, times]) => `${name} ${times}`);
  return run("keyboard", visit, inventory, targets.length === 0 || reached.size === 0 ? [...found, NO_TARGET] : found);
}, Effect.scoped);

const motionRun = Effect.fn("motionRun")(function* ({ browser, visit, url }: Visiting) {
  const { page } = yield* openVisit(browser, visit, recordMotion);
  yield* load(page, url);
  const { found, controls } = yield* judgeStillness(page);
  return run("motion", visit, [`${controls} control(s)`], controls === 0 ? [...found, "scanned no control"] : found);
}, Effect.scoped);

const axeRun = Effect.fn("axeRun")(function* ({ browser, visit, url }: Visiting) {
  const { page } = yield* openVisit(browser, visit);
  yield* load(page, url);
  const { found, unverified, rules } = yield* judgeAxe(page);
  return run("axe", visit, [`${rules} rule(s)`], rules === 0 ? [...found, "axe ran no rule"] : found, unverified);
}, Effect.scoped);

const nestingRun = Effect.fn("nestingRun")(function* ({ browser, visit, url }: Visiting) {
  const { page } = yield* openVisit(browser, visit);
  yield* load(page, url);
  const { found, elements } = yield* judgeNesting(page);
  return run("nesting", visit, [`${elements} element(s)`], found);
}, Effect.scoped);

const assetsRun = Effect.fn("assetsRun")(function* ({ browser, visit, url }: Visiting) {
  const { page } = yield* openVisit(browser, visit);
  const watch = watchAssets(page);
  yield* attempt(`cannot load ${url}`, () => page.goto(url, { waitUntil: "networkidle" }));
  return run("assets", visit, [`${watch.requested()} request(s)`], watch.found());
}, Effect.scoped);

const hookRun = Effect.fn("hookRun")(function* (check: ProductCheck, { browser, visit, url }: Visiting) {
  const { page } = yield* openVisit(browser, visit);
  const { targets, found } = yield* runHook(check, page, { ...visit, url });
  return run(`hook ${check.name}`, visit, counted(targets), targets.length === 0 ? [...found, NO_TARGET] : found);
}, Effect.scoped);

const BUILT_IN: Readonly<Record<CheckName, (visiting: Visiting) => Effect.Effect<Run, BrowserFailure>>> = {
  layout: layoutRun,
  keyboard: keyboardRun,
  motion: motionRun,
  axe: axeRun,
  nesting: nestingRun,
  assets: assetsRun,
};

function applies(check: CheckName, { state }: Visit): boolean {
  return check !== "motion" || state.reducedMotion === "reduce";
}

const checkSite = Effect.fn("checkSite")(function* (root: string, declaration: Declaration) {
  const site = yield* readSite(root, declaration.site);
  const paths = declaration.routes.map(({ path }) => path);
  const hooks = declaration.hooks === undefined ? [] : yield* loadHooks(root, declaration.hooks, paths);
  const missingRoutes = paths.filter((path) => !site.files.has(path));
  const undeclaredPages = site.pages.filter((page) => !paths.includes(page));
  const origin = yield* serveSite(site);
  const browser = yield* launchChrome;
  const runs: Run[] = [];
  for (const visit of visitsOf(declaration).filter(({ route }) => !missingRoutes.includes(route.path))) {
    const visiting = { browser, declaration, visit, url: new URL(visit.route.path, origin).href };
    for (const check of declaration.checks.filter((one) => applies(one, visit))) runs.push(yield* BUILT_IN[check](visiting));
    for (const hook of hooks.filter(({ routes }) => routes === undefined || routes.includes(visit.route.path))) runs.push(yield* hookRun(hook, visiting));
  }
  return { runs, missingRoutes, undeclaredPages };
}, Effect.scoped);

const browserChecks = Effect.gen(function* () {
  const root = (yield* Path.Path).resolve(process.argv[2] ?? ".");
  const declaration = yield* readDeclaration(root);
  const outcome = yield* checkSite(root, declaration);
  yield* Console.log(report(declaration, outcome));
  return passes(outcome);
});

if (import.meta.main) runMain(NAME, browserChecks);
