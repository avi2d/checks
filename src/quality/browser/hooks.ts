import { Effect, FileSystem, Path, Schema } from "effect";
import type { Page } from "playwright-core";
import { Usage } from "../../core/main.ts";
import type { Route, State, Viewport } from "./declaration.ts";
import { attempt } from "./page.ts";

export type HookVisit = {
  readonly route: Route;
  readonly viewport: Viewport;
  readonly state: State;
  readonly url: string;
};

const HookResult = Schema.Struct({ targets: Schema.Array(Schema.String), found: Schema.Array(Schema.String) });

export type HookResult = typeof HookResult.Type;

type RunHook = (page: Page, visit: HookVisit) => Promise<HookResult>;

const isRunHook = (value: unknown): value is RunHook => typeof value === "function";

const ProductCheck = Schema.Struct({
  name: Schema.NonEmptyString,
  routes: Schema.optionalKey(Schema.NonEmptyArray(Schema.NonEmptyString)),
  run: Schema.declare(isRunHook, { expected: "a function from a page and a visit to a promised result" }),
});

export type ProductCheck = typeof ProductCheck.Type;

const decodeHookModule = Schema.decodeUnknownEffect(Schema.Struct({ checks: Schema.NonEmptyArray(ProductCheck) }));

const decodeHookResult = Schema.decodeUnknownEffect(HookResult);

export const loadHooks = Effect.fn("loadHooks")(function* (root: string, hooks: string, paths: readonly string[]) {
  const file = (yield* Path.Path).resolve(root, hooks);
  if (!(yield* (yield* FileSystem.FileSystem).exists(file))) return yield* new Usage({ message: `the declared hooks module ${hooks} is missing` });
  const loaded: unknown = yield* attempt(`cannot load the hooks module ${hooks}`, () => import(file)).pipe(
    Effect.mapError(({ message }) => new Usage({ message })),
  );
  const { checks } = yield* decodeHookModule(loaded).pipe(
    Effect.mapError(({ message }) => new Usage({ message: `the hooks module ${hooks} exports no checks a runner can call: ${message}` })),
  );
  const names = checks.map(({ name }) => name);
  const problems = [
    ...names.filter((name, index) => names.indexOf(name) !== index).map((name) => `hook ${name} is exported twice`),
    ...checks.flatMap(({ name, routes = [] }) => routes.filter((path) => !paths.includes(path)).map((path) => `hook ${name} names route ${path}, which no route declares`)),
  ];
  if (problems.length > 0) return yield* new Usage({ message: `${hooks}: ${problems.join("; ")}` });
  return checks;
});

export const runHook = Effect.fn("runHook")(function* (check: ProductCheck, page: Page, visit: HookVisit) {
  return yield* attempt(`hook ${check.name} throws`, () => check.run(page, visit)).pipe(
    Effect.flatMap((result) => decodeHookResult(result).pipe(Effect.mapError(({ message }) => ({ message: `hook ${check.name} returns no result: ${message}` })))),
    Effect.catch(({ message }) => Effect.succeed({ targets: [], found: [message] })),
  );
});
