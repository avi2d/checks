import { Effect, FileSystem, Path, Schema } from "effect";
import { Usage } from "../../core/main.ts";

const DECLARATION = "browser-checks.json";

const CHECKS = ["layout", "keyboard", "motion", "axe", "nesting", "assets"] as const;

export type CheckName = (typeof CHECKS)[number];

const Name = Schema.NonEmptyString;
const Pixels = Schema.Int.check(Schema.isGreaterThan(0));

const Route = Schema.Struct({
  path: Schema.String.check(Schema.isPattern(/^\//, { message: "is not a path from the site root, such as /ru/" })),
  locale: Name,
});

const Viewport = Schema.Struct({ name: Name, width: Pixels, height: Pixels, touch: Schema.optionalKey(Schema.Boolean) });

const State = Schema.Struct({
  name: Name,
  textPx: Schema.optionalKey(Pixels),
  reducedMotion: Schema.optionalKey(Schema.Literals(["reduce", "no-preference"])),
});

const Target = Schema.Struct({
  name: Name,
  selector: Name,
  routes: Schema.optionalKey(Schema.NonEmptyArray(Name)),
  focusable: Schema.optionalKey(Schema.Boolean),
});

const Declaration = Schema.Struct({
  site: Name,
  routes: Schema.NonEmptyArray(Route),
  viewports: Schema.NonEmptyArray(Viewport),
  states: Schema.NonEmptyArray(State),
  targets: Schema.NonEmptyArray(Target),
  checks: Schema.NonEmptyArray(Schema.Literals(CHECKS)),
  hooks: Schema.optionalKey(Name),
});

export type Route = typeof Route.Type;
export type Viewport = typeof Viewport.Type;
export type State = typeof State.Type;
export type Target = typeof Target.Type;
export type Declaration = typeof Declaration.Type;

export type Visit = {
  readonly route: Route;
  readonly viewport: Viewport;
  readonly state: State;
};

const decodeDeclaration = Schema.decodeUnknownEffect(Schema.fromJsonString(Declaration));

function repeated(names: readonly string[]): readonly string[] {
  return [...new Set(names.filter((name, index) => names.indexOf(name) !== index))];
}

export function inconsistencies(declaration: Declaration): readonly string[] {
  const paths = declaration.routes.map(({ path }) => path);
  const found = [
    ...repeated(paths).map((path) => `route ${path} is declared twice`),
    ...repeated(declaration.viewports.map(({ name }) => name)).map((name) => `viewport ${name} is declared twice`),
    ...repeated(declaration.states.map(({ name }) => name)).map((name) => `state ${name} is declared twice`),
    ...repeated(declaration.targets.map(({ name }) => name)).map((name) => `target ${name} is declared twice`),
    ...repeated(declaration.checks).map((check) => `check ${check} is declared twice`),
    ...declaration.targets.flatMap(({ name, routes = [] }) =>
      routes.filter((path) => !paths.includes(path)).map((path) => `target ${name} names route ${path}, which no route declares`),
    ),
  ];
  if (declaration.checks.includes("motion") && !declaration.states.some(({ reducedMotion }) => reducedMotion === "reduce")) {
    found.push("check motion judges a visitor who turns motion off, and no state sets reducedMotion to reduce");
  }
  if (declaration.checks.includes("keyboard") && !declaration.targets.some(({ focusable }) => focusable === true)) {
    found.push("check keyboard judges the targets Tab reaches, and no target sets focusable");
  }
  return found;
}

export const readDeclaration = Effect.fn("readDeclaration")(function* (root: string) {
  const fs = yield* FileSystem.FileSystem;
  const file = (yield* Path.Path).join(root, DECLARATION);
  if (!(yield* fs.exists(file))) {
    return yield* new Usage({ message: `${DECLARATION} is missing, and a product opts in to the browser checks by declaring its pages there` });
  }
  const declaration = yield* decodeDeclaration(yield* fs.readFileString(file)).pipe(
    Effect.mapError(({ message }) => new Usage({ message: `${DECLARATION} does not decode: ${message}` })),
  );
  const found = inconsistencies(declaration);
  if (found.length > 0) return yield* new Usage({ message: `${DECLARATION}: ${found.join("; ")}` });
  return declaration;
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
