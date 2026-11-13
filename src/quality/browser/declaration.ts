import { Array as Arr, Effect, FileSystem, Path, Schema } from "effect";
import { Usage } from "../../core/main.ts";
import { readSite, sitePages, type Site } from "./serve.ts";
import { DEVICES, ENLARGED_TEXT_PX, SCREEN_SIZE_SETS, SCREEN_SIZES, screenSizeName, type ScreenSize } from "./screen-sizes.ts";

const DECLARATION = "browser-checks.json";

const CHECKS = ["layout", "keyboard", "motion", "axe", "nesting", "html", "links", "assets", "contrast", "weight", "shift"] as const;

export type CheckName = (typeof CHECKS)[number];

const Name = Schema.NonEmptyString;
const Pixels = Schema.Int.check(Schema.isGreaterThan(0));
const Bytes = Schema.Int.check(Schema.isGreaterThan(0));

const Route = Schema.Struct({
  path: Schema.String.check(Schema.isPattern(/^\//, { message: "is not a path from the site root, such as /ru/" })),
  locale: Name,
});

const ROUTE_PRESETS = ["every-page"] as const;

const RoutePreset = Schema.Struct({ preset: Schema.Literals(ROUTE_PRESETS), locale: Name });

const Viewport = Schema.Struct({
  name: Name,
  width: Pixels,
  height: Pixels,
  touch: Schema.optionalKey(Schema.Boolean),
  device: Schema.optionalKey(Schema.Literals(DEVICES)),
});

const ScreenSizeSet = Schema.Struct({ preset: Schema.Literals(SCREEN_SIZE_SETS) });

const State = Schema.Struct({
  name: Name,
  textPx: Schema.optionalKey(Pixels),
  reducedMotion: Schema.optionalKey(Schema.Literals(["reduce", "no-preference"])),
  checks: Schema.optionalKey(Schema.NonEmptyArray(Schema.Literals(CHECKS))),
});

const STATE_PRESETS = ["enlarged-text"] as const;

const StatePreset = Schema.Struct({ preset: Schema.Literals(STATE_PRESETS) });

const Target = Schema.Struct({
  name: Name,
  selector: Name,
  routes: Schema.optionalKey(Schema.NonEmptyArray(Name)),
  focusable: Schema.optionalKey(Schema.Boolean),
  contrast: Schema.optionalKey(Schema.Boolean),
});

const WeightBudgets = Schema.Struct({
  nonImageBytes: Bytes,
  scriptBytes: Bytes,
  imageBytes: Bytes,
});

const ShiftBound = Schema.Struct({
  max: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)),
});

const Declaration = Schema.Struct({
  site: Name,
  routes: Schema.NonEmptyArray(Route),
  viewports: Schema.NonEmptyArray(Viewport),
  states: Schema.NonEmptyArray(State),
  targets: Schema.NonEmptyArray(Target),
  checks: Schema.NonEmptyArray(Schema.Literals(CHECKS)),
  weight: Schema.optionalKey(WeightBudgets),
  shift: Schema.optionalKey(ShiftBound),
  hooks: Schema.optionalKey(Name),
});

const Listed = Schema.Struct({
  ...Declaration.fields,
  routes: Schema.NonEmptyArray(Schema.Union([Route, RoutePreset])),
  viewports: Schema.NonEmptyArray(Schema.Union([Viewport, ScreenSizeSet])),
  states: Schema.NonEmptyArray(Schema.Union([State, StatePreset])),
});

export type Route = typeof Route.Type;
export type Viewport = typeof Viewport.Type;
export type State = typeof State.Type;
export type Target = typeof Target.Type;
export type WeightBudgets = typeof WeightBudgets.Type;
export type ShiftBound = typeof ShiftBound.Type;
export type Declaration = typeof Declaration.Type;

export type Visit = {
  readonly route: Route;
  readonly viewport: Viewport;
  readonly state: State;
};

export type Listed = typeof Listed.Type;

const decodeListed = Schema.decodeUnknownEffect(Schema.fromJsonString(Listed));

function viewportOf(size: ScreenSize): Viewport {
  const { device, width, height } = size;
  return { name: screenSizeName(size), width, height, device, ...(device === "phone" ? { touch: true } : {}) };
}

const STATES: Readonly<Record<(typeof STATE_PRESETS)[number], State>> = {
  "enlarged-text": { name: "enlarged text", textPx: ENLARGED_TEXT_PX },
};

export function expanded(listed: Listed, pages: readonly string[]): Declaration {
  const explicit = new Set(listed.routes.flatMap((entry) => ("preset" in entry ? [] : [entry.path])));
  return {
    ...listed,
    routes: Arr.flatMap(listed.routes, (entry) =>
      "preset" in entry ? Arr.map(pages.filter((path) => !explicit.has(path)), (path) => ({ path, locale: entry.locale })) : [entry],
    ),
    viewports: Arr.flatMap(listed.viewports, (entry) => ("preset" in entry ? Arr.map(SCREEN_SIZES[entry.preset], viewportOf) : [entry])),
    states: Arr.map(listed.states, (entry) => ("preset" in entry ? STATES[entry.preset] : entry)),
  };
}

export function runsIn(state: State, check: CheckName): boolean {
  return state.checks === undefined || state.checks.includes(check);
}

function stateInconsistencies({ states, checks }: Declaration): readonly string[] {
  return [
    ...states.flatMap(({ name, checks: named = [] }) => [
      ...repeated(named).map((check) => `state ${name} names check ${check} twice`),
      ...named.filter((check) => !checks.includes(check)).map((check) => `state ${name} names check ${check}, which checks does not declare`),
    ]),
    ...states
      .filter((state) => state.reducedMotion !== "reduce" && state.checks?.includes("motion") === true)
      .map(({ name }) => `state ${name} names check motion, which runs only in a state whose reducedMotion is reduce`),
    ...checks
      .filter((check) => check !== "motion" && !states.some((state) => runsIn(state, check)))
      .map((check) => `check ${check} runs in no state, since each state names its checks without it`),
  ];
}

function repeated(names: readonly string[]): readonly string[] {
  return [...new Set(names.filter((name, index) => names.indexOf(name) !== index))];
}

export function inconsistencies(declaration: Declaration, skipTargetRoutes = false): readonly string[] {
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
  if (declaration.checks.includes("motion") && !declaration.states.some((state) => state.reducedMotion === "reduce" && runsIn(state, "motion"))) {
    found.push("check motion judges a visitor who turns motion off, and no state that runs it sets reducedMotion to reduce");
  }
  if (declaration.checks.includes("keyboard") && !declaration.targets.some(({ focusable }) => focusable === true)) {
    found.push("check keyboard judges the targets Tab reaches, and no target sets focusable");
  }
  if (declaration.checks.includes("contrast") && !declaration.targets.some(({ contrast }) => contrast === true)) {
    found.push("check contrast measures the text over a photo or a gradient, and no target sets contrast");
  }
  if (declaration.checks.includes("weight") && declaration.weight === undefined) {
    found.push("check weight judges the bytes each page transfers, and no budgets declare them");
  }
  if (declaration.checks.includes("shift") && declaration.shift === undefined) {
    found.push("check shift judges the movement of a cold load, and no bound declares it");
  }
  if (declaration.hooks !== undefined && declaration.states.every((state) => state.checks !== undefined)) {
    found.push("hooks run in no state, since each state names its checks");
  }
  return found;
}

export const readDeclaration = Effect.fn("readDeclaration")(function* (root: string) {
  const fs = yield* FileSystem.FileSystem;
  const file = (yield* Path.Path).join(root, DECLARATION);
  if (!(yield* fs.exists(file))) {
    return yield* new Usage({ message: `${DECLARATION} is missing, and a product opts in to the browser checks by declaring its pages there` });
  }
  const listed = yield* decodeListed(yield* fs.readFileString(file)).pipe(
    Effect.mapError(({ message }) => new Usage({ message: `${DECLARATION} does not decode: ${message}` })),
  );
  const hasPreset = listed.routes.some((entry) => "preset" in entry);
  const early = inconsistencies(expanded(listed, []), hasPreset);
  if (early.length > 0) return yield* new Usage({ message: `${DECLARATION}: ${early.join("; ")}` });
  const site = yield* readSite(root, listed.site);
  const pages = sitePages(site);
  if (hasPreset && pages.length === 0) {
    return yield* new Usage({ message: `the declared site ${listed.site} holds no .html page, so build the site before the browser checks run` });
  }
  const declaration = expanded(listed, pages);
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
