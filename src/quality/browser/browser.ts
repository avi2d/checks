#!/usr/bin/env bun
import { Console, Effect, Path } from "effect";
import type { Browser, Page } from "playwright-core";
import { runMain, Usage } from "../../core/main.ts";
import { refuseLocalTests } from "../../core/local-tests.ts";
import { readRunScope, type RunScope } from "../../core/pull-request-scope.ts";
import { browserArgs } from "./args.ts";
import { identicalTestBuild } from "./build-proof.ts";
import { watchAssets } from "./assets.ts";
import { judgeAxe } from "./axe.ts";
import { judgeContrast } from "./contrast.ts";
import { isDefaultState, readDeclaration, runsIn, targetsOn, visitsOf, type CheckName, type Declaration, type Visit } from "./declaration.ts";
import { hookApplies, loadHooks, runHook, type ProductCheck } from "./hooks.ts";
import { judgeHtml } from "./html.ts";
import { judgeKeyboard } from "./keyboard.ts";
import { judgeLayout } from "./layout.ts";
import { judgeLinks } from "./links.ts";
import { judgeLook, readLook, type FirstLooks } from "./look.ts";
import { judgeStillness, recordMotion } from "./motion.ts";
import { judgeNesting } from "./nesting.ts";
import { coldShift, formatShift, judgeShift, recordShifts } from "./shift.ts";
import { walkCells, type Cell } from "./cells.ts";
import { attempt, launchChrome, load, openVisit, type BrowserFailure } from "./page.ts";
import { counted, formatTimings, NAME, passes, report, type Run, type Timing } from "./report.ts";
import { serveSite, type Site } from "./serve.ts";
import { judgePageWeight, weighPage } from "./weight.ts";
import { judgeTargets } from "./targets.ts";
import { fullRouteReason, reachedRoutes } from "./route-scope.ts";
import { compareReport, PAGE_OF, planCells } from "./schedule.ts";

const NO_TARGET = "scanned no target";

type Visiting = {
  readonly browser: Browser;
  readonly declaration: Declaration;
  readonly visit: Visit;
  readonly url: string;
};

type LoadedVisit = Pick<Visiting, "declaration" | "visit"> & { readonly page: Page };

// Look needs the first text of each role in visit order, not in completion order.
type Settle = (firstLooks: FirstLooks) => Run;

const settled = (one: Run): Settle => () => one;

const run = (check: string, visit: Visit, inventory: readonly string[], found: readonly string[], unverified: readonly string[] = []): Run => ({
  check,
  visit,
  inventory,
  found,
  unverified,
});

const targetsRun = Effect.fn("targetsRun")(function* ({ declaration, visit, page }: LoadedVisit) {
  const targets = targetsOn(declaration, visit.route.path);
  const { found, visible } = yield* judgeTargets(page, targets);
  const inventory = [...visible].map(([name, count]) => `${name} ${count}`);
  return run("targets", visit, inventory, targets.length === 0 ? [...found, NO_TARGET] : found);
});

const layoutRun = Effect.fn("layoutRun")(function* ({ browser, declaration, visit, url }: Visiting) {
  const { cdp, page } = yield* openVisit(browser, visit);
  yield* load(page, url);
  const { found, scanned, parked } = yield* judgeLayout(cdp, targetsOn(declaration, visit.route.path));
  const inventory = [...counted(scanned.map(({ name }) => name)), ...counted(parked).map((one) => `${one} parked until focused`)];
  return run("layout", visit, inventory, scanned.length === 0 ? [...found, NO_TARGET] : found);
}, Effect.scoped);

const keyboardRun = Effect.fn("keyboardRun")(function* ({ browser, declaration, visit, url }: Visiting) {
  const targets = targetsOn(declaration, visit.route.path).filter(({ focusable }) => focusable === true);
  const { page } = yield* openVisit(browser, visit);
  yield* load(page, url);
  const { found, reached, complete, notMeasured } = yield* judgeKeyboard(page, targets);
  const inventory = [...[...reached].map(([name, times]) => `${name} ${times}`), ...notMeasured];
  if (!complete) inventory.push("Tab order differed from the reference pass, not measured");
  return run("keyboard", visit, inventory, targets.length === 0 || (complete && reached.size === 0) ? [...found, NO_TARGET] : found);
}, Effect.scoped);

const motionRun = Effect.fn("motionRun")(function* ({ browser, visit, url }: Visiting) {
  const { page } = yield* openVisit(browser, visit, recordMotion);
  yield* load(page, url);
  const { found, controls, unhovered } = yield* judgeStillness(page);
  const inventory = [`${controls} control(s)`, ...(unhovered === 0 ? [] : [`${unhovered} it cannot hover, judged on focus alone`])];
  return run("motion", visit, inventory, controls === 0 ? [...found, "scanned no control"] : found);
}, Effect.scoped);

const axeRun = Effect.fn("axeRun")(function* ({ browser, visit, url }: Visiting) {
  const { page } = yield* openVisit(browser, visit);
  yield* load(page, url);
  const { found, unverified, rules } = yield* judgeAxe(page);
  return run("axe", visit, [`${rules} rule(s)`], rules === 0 ? [...found, "axe ran no rule"] : found, unverified);
}, Effect.scoped);

const nestingRun = Effect.fn("nestingRun")(function* ({ visit, page }: LoadedVisit) {
  const { found, elements } = yield* judgeNesting(page);
  return run("nesting", visit, [`${elements} element(s)`], found);
});

const htmlRun = Effect.fn("htmlRun")(function* ({ visit, url }: Visiting) {
  const { found } = yield* judgeHtml(url);
  return run("html", visit, ["served page"], found);
});

const linksRun = Effect.fn("linksRun")(function* ({ browser, visit, url }: Visiting) {
  const { page } = yield* openVisit(browser, visit);
  const { found, links } = yield* judgeLinks(page, url);
  return run("links", visit, [`${links} same-site link(s)`], found);
}, Effect.scoped);

const assetsRun = Effect.fn("assetsRun")(function* ({ browser, visit, url }: Visiting) {
  const { page } = yield* openVisit(browser, visit);
  const watch = watchAssets(page, new URL(url).origin);
  yield* attempt(`cannot load ${url}`, () => page.goto(url, { waitUntil: "networkidle" }));
  return run("assets", visit, [`${watch.requested()} request(s)`], watch.found());
}, Effect.scoped);

const weightRun = Effect.fn("weightRun")(function* ({ browser, declaration, visit, url }: Visiting) {
  const budgets = declaration.weight;
  if (budgets === undefined) return run("weight", visit, [], ["check weight judges the bytes each page transfers, and no budgets declare them"]);
  const { page } = yield* openVisit(browser, visit);
  const weight = yield* weighPage(page, url);
  return run("weight", visit, [`${weight.responses} response(s)`], judgePageWeight(budgets, weight));
}, Effect.scoped);

const shiftRun = Effect.fn("shiftRun")(function* ({ browser, declaration, visit, url }: Visiting) {
  const bound = declaration.shift;
  if (bound === undefined) return run("shift", visit, [], ["check shift judges the movement of a cold load, and no bound declares it"]);
  const { page } = yield* openVisit(browser, visit, recordShifts);
  yield* load(page, url);
  const total = yield* coldShift(page, url);
  return run("shift", visit, [`shift ${formatShift(total)}`], judgeShift(bound, total));
}, Effect.scoped);

const contrastRun = Effect.fn("contrastRun")(function* ({ browser, declaration, visit, url }: Visiting) {
  const targets = targetsOn(declaration, visit.route.path).filter(({ contrast }) => contrast === true);
  const { page } = yield* openVisit(browser, visit);
  yield* load(page, url);
  const { found, inventory } = yield* judgeContrast(page, targets);
  return run("contrast", visit, inventory, targets.length === 0 ? [...found, NO_TARGET] : found);
}, Effect.scoped);

const lookRun = Effect.fn("lookRun")(function* ({ browser, declaration, visit, url }: Visiting) {
  const roles = declaration.roles;
  if (roles === undefined) return settled(run("look", visit, [], ["check look judges each visible text by the role it plays, and no roles declare them"]));
  const { page } = yield* openVisit(browser, visit);
  yield* load(page, url);
  const reading = yield* readLook(page, roles);
  return (firstLooks: FirstLooks): Run => {
    const { found, inventory } = judgeLook(reading, firstLooks, visit);
    return run("look", visit, inventory, found);
  };
}, Effect.scoped);

const hookRun = Effect.fn("hookRun")(function* (check: ProductCheck, { browser, visit, url }: Visiting) {
  const { page } = yield* openVisit(browser, visit);
  const { targets, found } = yield* runHook(check, page, { ...visit, url });
  return run(`hook ${check.name}`, visit, counted(targets), targets.length === 0 ? [...found, NO_TARGET] : found);
}, Effect.scoped);

type Reading = Effect.Effect<Settle, BrowserFailure>;

type SharedCheck = { readonly mode: "shared"; readonly alone: false; readonly read: (loaded: LoadedVisit) => Reading };
type PlannedCheck = SharedCheck
  | { readonly mode: "independent"; readonly read: (visiting: Visiting) => Reading; readonly alone: boolean };

const now =
  <Input>(check: (input: Input) => Effect.Effect<Run, BrowserFailure>) =>
  (input: Input): Reading =>
    Effect.map(check(input), settled);

const shared = (read: SharedCheck["read"]): SharedCheck => ({ mode: "shared", alone: false, read });
const independent = (read: (visiting: Visiting) => Reading, alone = false): PlannedCheck => ({ mode: "independent", read, alone });

const BUILT_IN: Readonly<Record<CheckName, PlannedCheck>> = {
  layout: independent(now(layoutRun), PAGE_OF.layout.alone),
  keyboard: independent(now(keyboardRun), PAGE_OF.keyboard.alone),
  motion: independent(now(motionRun), PAGE_OF.motion.alone),
  axe: independent(now(axeRun), PAGE_OF.axe.alone),
  nesting: shared(now(nestingRun)),
  html: independent(now(htmlRun), PAGE_OF.html.alone),
  links: independent(now(linksRun), PAGE_OF.links.alone),
  assets: independent(now(assetsRun), PAGE_OF.assets.alone),
  contrast: independent(now(contrastRun), PAGE_OF.contrast.alone),
  weight: independent(now(weightRun), PAGE_OF.weight.alone),
  shift: independent(now(shiftRun), PAGE_OF.shift.alone),
  look: independent(lookRun, PAGE_OF.look.alone),
};

type OrderedReading = {
  readonly visitIndex: number;
  readonly checkIndex: number;
  readonly settle: Settle;
  readonly start: number;
  readonly end: number;
};

const readShared = Effect.fn("readShared")(function* (
  { browser, declaration, visit, url }: Visiting,
  visitIndex: number,
  checks: readonly (SharedCheck & { readonly checkIndex: number })[],
) {
  let start = yield* Effect.sync(() => performance.now());
  const { page } = yield* openVisit(browser, visit);
  yield* load(page, url);
  return yield* Effect.forEach(checks, ({ read, checkIndex }) => Effect.gen(function* () {
    const checkStart = start;
    const settle = yield* read({ declaration, visit, page });
    const end = yield* Effect.sync(() => performance.now());
    start = end;
    return { visitIndex, checkIndex, settle, start: checkStart, end };
  }));
}, Effect.scoped);

function visitCells(visiting: Visiting, visitIndex: number, checks: readonly PlannedCheck[]): readonly Cell<readonly OrderedReading[], BrowserFailure>[] {
  const indexed = checks.map((check, checkIndex) => ({ ...check, checkIndex }));
  const { shared: sharedChecks, separate } = planCells(indexed);
  return [
    ...(sharedChecks.length === 0 ? [] : [{ reading: readShared(visiting, visitIndex, sharedChecks), alone: false }]),
    ...separate.map((check) => ({
      reading: Effect.gen(function* () {
        const start = yield* Effect.sync(() => performance.now());
        const settle = yield* check.read(visiting);
        const end = yield* Effect.sync(() => performance.now());
        return [{ visitIndex, checkIndex: check.checkIndex, settle, start, end }];
      }),
      alone: check.alone,
    })),
  ];
}

function applies(check: CheckName, visit: Visit, declaration: Declaration): boolean {
  if (!runsIn(visit.state, check)) return false;
  if (check === "look") return isDefaultState(visit.state);
  if (check === "motion") return visit.state.reducedMotion === "reduce";
  if (check === "html" || check === "links")
    return visit.viewport.name === declaration.viewports[0].name && visit.state.name === declaration.states.find((state) => runsIn(state, check))?.name;
  return true;
}

const checkSite = Effect.fn("checkSite")(function* (root: string, declaration: Declaration, site: Site, selected: ReadonlySet<string> | undefined) {
  const paths = declaration.routes.map(({ path }) => path);
  const hooks = declaration.hooks === undefined ? [] : yield* loadHooks(root, declaration.hooks, paths);
  const missingRoutes = paths.filter((path) => !site.files.has(path));
  const origin = yield* serveSite(site);
  const browser = yield* launchChrome;
  const cells = visitsOf(declaration)
    .filter(({ route }) => !missingRoutes.includes(route.path))
    .flatMap((visit, visitIndex) => {
      const visiting = { browser, declaration, visit, url: new URL(visit.route.path, origin).href };
      const reached = selected === undefined || selected.has(visit.route.path);
      return visitCells(visiting, visitIndex, [
        ...(reached ? [shared(now(targetsRun))] : []),
        ...declaration.checks.filter((one) => (reached || one === "look" || one === "links") && applies(one, visit, declaration)).map((check) => BUILT_IN[check]),
        ...(reached ? hooks.filter((candidate) => hookApplies(candidate, visit)).map((hook) => independent(now((one) => hookRun(hook, one)), PAGE_OF.hook.alone)) : []),
      ]);
    });
  const readings = (yield* walkCells(cells, 4)).flat().sort(compareReport);
  const firstLooks: FirstLooks = new Map();
  const finished = readings.map(({ settle, start, end }) => ({ run: settle(firstLooks), start, end }));
  const timings: Timing[] = finished.map(({ run: one, start, end }) => ({ path: one.visit.route.path, check: one.check, start, end }));
  return { runs: finished.map(({ run: one }) => one), missingRoutes, timings };
}, Effect.scoped);

const USAGE = `usage: ${NAME} [--pr] [<directory>]`;

const largestSet = Effect.fn("largestSet")(function* (scope: RunScope | undefined) {
  if (scope === undefined) return "full" as const;
  if (scope.kind === "docs-only") return undefined;
  if (scope.kind === "pull-request") {
    yield* Console.log(`${NAME}: a pull request run walks every preset at the anchor sizes`);
    return "anchor" as const;
  }
  yield* Console.log(`${NAME}: ${scope.because}, so every preset walks the full size list`);
  return "full" as const;
});

const browserChecks = Effect.gen(function* () {
  const args = browserArgs(process.argv.slice(2));
  if (args === undefined) return yield* new Usage({ message: USAGE });
  const root = (yield* Path.Path).resolve(args.directory);
  yield* refuseLocalTests(root);
  const requested = args.pr ? yield* readRunScope(root) : undefined;
  const because = requested?.kind === "pull-request" ? fullRouteReason(requested.changed) : undefined;
  const scope = because === undefined ? requested : { kind: "whole", because } satisfies RunScope;
  const largest = yield* largestSet(scope);
  if (largest === undefined) {
    yield* Console.log(`${NAME}: the pull request changes only top-level and docs/ Markdown, so no page was checked`);
    return true;
  }
  const { declaration, site } = yield* readDeclaration(root, largest);
  if (scope?.kind === "pull-request" && (yield* identicalTestBuild(root, declaration.site, scope, declaration.hooks))) {
    yield* Console.log(`${NAME}: the test-only change builds the same site, so no page was checked`);
    return true;
  }
  const selection = scope?.kind === "pull-request" ? yield* reachedRoutes(root, scope.changed, declaration) : undefined;
  if (selection?.kind === "full") yield* Console.log(`${NAME}: ${selection.because}, so every route runs`);
  const selected = selection?.kind === "routes" ? selection.routes : undefined;
  if (selected?.size === 0) {
    yield* Console.log(`${NAME}: the pull request reaches no route, so no page was checked`);
    return true;
  }
  if (selected !== undefined) yield* Console.log(`${NAME}: the pull request reaches ${selected.size} of ${declaration.routes.length} route(s)`);
  const outcome = yield* checkSite(root, declaration, site, selected);
  yield* Console.log(report(declaration, outcome));
  const timings = formatTimings(outcome.timings);
  if (timings !== "") yield* Console.log(timings);
  return passes(outcome);
});

if (import.meta.main) runMain(NAME, browserChecks);
