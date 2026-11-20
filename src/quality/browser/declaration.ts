import { Array as Arr, Effect } from "effect";
import { STATE_PRESETS, type CheckName, type Declaration, type Listed, type Route, type State, type Target, type Viewport } from "../../core/browser-settings.ts";
import { Usage } from "../../core/main.ts";
import { readSetting, SETTINGS_FILE, Settings } from "../../core/settings.ts";
import { readSite, sitePages, type Site } from "./serve.ts";
import { ENLARGED_TEXT_PX, SCREEN_SIZES, screenSizeName, type ScreenSize, type ScreenSizeSet } from "./screen-sizes.ts";

export type { CheckName, Declaration, Listed, Roles, Route, ShiftBound, State, Target, Viewport, WeightBudgets } from "../../core/browser-settings.ts";

const OLD_DECLARATION = "browser-checks.json";

const DECLARATION = `${SETTINGS_FILE} browser`;

export type ExpandedDeclaration = Omit<Declaration, "routes"> & { readonly routes: readonly Route[] };

export type Visit = {
  readonly route: Route;
  readonly viewport: Viewport;
  readonly state: State;
};

function viewportOf(size: ScreenSize): Viewport {
  const { device, width, height } = size;
  return { name: screenSizeName(size), width, height, device, ...(device === "phone" ? { touch: true } : {}) };
}

const STATES: Readonly<Record<(typeof STATE_PRESETS)[number], State>> = {
  "enlarged-text": { name: "enlarged text", textPx: ENLARGED_TEXT_PX },
};

// A preset expands to at most the largest set, so an anchor run turns a full preset into the anchor sizes.
function presetSizes(preset: ScreenSizeSet, largest: ScreenSizeSet): Arr.NonEmptyReadonlyArray<ScreenSize> {
  return SCREEN_SIZES[largest === "anchor" ? "anchor" : preset];
}

export function expanded(listed: Listed, pages: readonly string[], largest: ScreenSizeSet = "full"): ExpandedDeclaration {
  const explicit = new Set(listed.routes.flatMap((entry) => ("preset" in entry ? [] : [entry.path])));
  return {
    ...listed,
    routes: Arr.flatMap(listed.routes, (entry) =>
      "preset" in entry ? Arr.map(pages.filter((path) => !explicit.has(path)), (path) => ({ path, locale: entry.locale })) : [entry],
    ),
    viewports: Arr.flatMap(listed.viewports, (entry) => ("preset" in entry ? Arr.map(presetSizes(entry.preset, largest), viewportOf) : [entry])),
    states: Arr.map(listed.states, (entry) => ("preset" in entry ? STATES[entry.preset] : entry)),
  };
}

export function runsIn(state: State, check: CheckName): boolean {
  return state.checks === undefined || state.checks.includes(check);
}

export function isDefaultState(state: State): boolean {
  return state.textPx === undefined && state.reducedMotion !== "reduce";
}

function stateInconsistencies({ states, checks }: ExpandedDeclaration): readonly string[] {
  return [
    ...states.flatMap(({ name, checks: named = [] }) => [
      ...repeated(named).map((check) => `state ${name} names check ${check} twice`),
      ...named.filter((check) => !checks.includes(check)).map((check) => `state ${name} names check ${check}, which checks does not declare`),
    ]),
    ...states
      .filter((state) => state.reducedMotion !== "reduce" && state.checks?.includes("motion") === true)
      .map(({ name }) => `state ${name} names check motion, which runs only in a state whose reducedMotion is reduce`),
    ...states
      .filter((state) => !isDefaultState(state) && state.checks?.includes("look") === true)
      .map(({ name }) => `state ${name} names check look, which runs only in a state with no textPx and whose reducedMotion is not reduce`),
    ...checks
      .filter((check) => check !== "motion" && check !== "look" && !states.some((state) => runsIn(state, check)))
      .map((check) => `check ${check} runs in no state, since each state names its checks without it`),
    ...checks
      .filter((check) => check === "look" && !states.some((state) => isDefaultState(state) && runsIn(state, check)))
      .map(() => "check look runs only in a state with no textPx and whose reducedMotion is not reduce, and no such state runs it"),
  ];
}

function repeated(names: readonly string[]): readonly string[] {
  return [...new Set(names.filter((name, index) => names.indexOf(name) !== index))];
}

const checkInputs: readonly (readonly [CheckName, (declaration: ExpandedDeclaration) => boolean, string])[] = [
  [
    "motion",
    ({ states }) => !states.some((state) => state.reducedMotion === "reduce" && runsIn(state, "motion")),
    "check motion judges a visitor who turns motion off, and no state that runs it sets reducedMotion to reduce",
  ],
  ["keyboard", ({ targets }) => !targets.some(({ focusable }) => focusable === true), "check keyboard judges the targets Tab reaches, and no target sets focusable"],
  ["contrast", ({ targets }) => !targets.some(({ contrast }) => contrast === true), "check contrast measures the text over a photo or a gradient, and no target sets contrast"],
  ["weight", ({ weight }) => weight === undefined, "check weight judges the bytes each page transfers, and no budgets declare them"],
  ["shift", ({ shift }) => shift === undefined, "check shift judges the movement of a cold load, and no bound declares it"],
  ["look", ({ roles }) => roles === undefined, "check look judges each visible text by the role it plays, and no roles declare them"],
];

export function inconsistencies(declaration: ExpandedDeclaration, skipTargetRoutes = false): readonly string[] {
  const paths = declaration.routes.map(({ path }) => path);
  const found = [
    ...repeated(paths).map((path) => `route ${path} is declared twice`),
    ...repeated(declaration.viewports.map(({ name }) => name)).map((name) => `viewport ${name} is declared twice`),
    ...repeated(declaration.states.map(({ name }) => name)).map((name) => `state ${name} is declared twice`),
    ...repeated(declaration.targets.map(({ name }) => name)).map((name) => `target ${name} is declared twice`),
    ...repeated(declaration.checks).map((check) => `check ${check} is declared twice`),
    ...(skipTargetRoutes ? [] : declaration.targets.flatMap(({ name, routes = [] }) =>
      routes.filter((path) => !paths.includes(path)).map((path) => `target ${name} names route ${path}, which no route declares`))),
    ...stateInconsistencies(declaration),
  ];
  for (const [check, unmet, message] of checkInputs) {
    if (declaration.checks.includes(check) && unmet(declaration)) found.push(message);
  }
  if (declaration.roles !== undefined && Object.keys(declaration.roles).length === 0) {
    found.push("roles declares no role, so every visible text would match none");
  }
  if (declaration.hooks !== undefined && declaration.states.every((state) => state.checks !== undefined)) {
    found.push("hooks run in no state, since each state names its checks");
  }
  return found;
}

export const readDeclaration = Effect.fn("readDeclaration")(function* (root: string, largest: ScreenSizeSet = "full") {
  const listed = yield* readSetting(root, "browser", Settings.fields.browser, { file: OLD_DECLARATION });
  if (listed === undefined) {
    return yield* new Usage({ message: `${SETTINGS_FILE} sets no browser key, and a product opts in to the browser checks by declaring its pages there` });
  }
  const hasPreset = listed.routes.some((entry) => "preset" in entry);
  const early = inconsistencies(expanded(listed, []), hasPreset);
  if (early.length > 0) return yield* new Usage({ message: `${DECLARATION}: ${early.join("; ")}` });
  const site = yield* readSite(root, listed.site);
  const candidate = expanded(listed, sitePages(site), largest);
  const { routes } = candidate;
  if (!Arr.isReadonlyArrayNonEmpty(routes)) {
    return yield* new Usage({ message: `the declared site ${listed.site} holds no .html page, so build the site before the browser checks run` });
  }
  const declaration: Declaration = { ...candidate, routes };
  const found = inconsistencies(declaration);
  if (found.length > 0) return yield* new Usage({ message: `${DECLARATION}: ${found.join("; ")}` });
  return { declaration, site } satisfies { readonly declaration: Declaration; readonly site: Site };
});

export function visitsOf({ routes, viewports, states }: Declaration): readonly Visit[] {
  return routes.flatMap((route) => viewports.flatMap((viewport) => states.map((state) => ({ route, viewport, state }))));
}

export function targetsOn(declaration: Declaration, path: string): readonly Target[] {
  return declaration.targets.filter(({ routes }) => routes === undefined || routes.includes(path));
}

export function describeVisit({ route, viewport, state }: Visit): string {
  const touch = viewport.touch === true ? " touch" : "";
  return `${route.path} (${route.locale}), ${viewport.name} ${viewport.width}x${viewport.height}${touch}, ${state.name}`;
}
