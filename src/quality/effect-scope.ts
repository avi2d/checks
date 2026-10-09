#!/usr/bin/env bun
import { Console, Effect, FileSystem, Path, Schema } from "effect";
import { git } from "../core/git.ts";
import { runMain, Usage } from "../core/main.ts";
import { effectRules } from "./presets/oxlint.ts";
import severities from "./presets/effect.language-service.json" with { type: "json" };

export const OXLINT_CONFIG = "oxlint.config.ts";
export const TSCONFIG = "tsconfig.json";
export const LANGUAGE_SERVICE = "@effect/language-service";

const NAME = "effect-scope";
const CHECK = "--check";
const USAGE = `usage: effect-scope.ts [${CHECK}]`;

class EffectScopeError extends Schema.TaggedError<EffectScopeError>()("EffectScopeError", {
  message: Schema.String,
}) {}

const JsonObject = Schema.Record(Schema.String, Schema.Unknown);

type JsonObject = typeof JsonObject.Type;

const Override = Schema.Struct({
  files: Schema.Array(Schema.String),
  excludeFiles: Schema.optionalKey(Schema.Array(Schema.String)),
  rules: Schema.optionalKey(JsonObject),
});

const OxlintModule = Schema.Struct({ default: Schema.Struct({ overrides: Schema.optionalKey(Schema.Array(Override)) }) });

const decodeOxlintModule = Schema.decodeUnknownEffect(OxlintModule);
const decodeTsconfig = Schema.decodeUnknownEffect(Schema.fromJsonString(JsonObject));
const decodeObject = Schema.decodeUnknownEffect(JsonObject);
const decodePlugins = Schema.decodeUnknownEffect(Schema.Array(JsonObject));

export type ServiceOverride = {
  readonly include: readonly string[];
  readonly exclude?: readonly string[];
  readonly options: typeof severities;
};

const EFFECT_RULES = JSON.stringify(effectRules([]).rules);

export function serviceOverrides(overrides: readonly (typeof Override.Type)[]): readonly ServiceOverride[] {
  return overrides
    .filter(({ rules }) => JSON.stringify(rules) === EFFECT_RULES)
    .map(({ files, excludeFiles = [] }) => (excludeFiles.length === 0 ? { include: files, options: severities } : { include: files, exclude: excludeFiles, options: severities }));
}

function ownedBy(plugin: JsonObject, overrides: readonly ServiceOverride[]): JsonObject {
  const { overrides: _, ...rest } = plugin;
  return overrides.length === 0 ? rest : { ...rest, overrides };
}

export function withServiceOverrides(plugins: readonly JsonObject[], overrides: readonly ServiceOverride[]): readonly JsonObject[] {
  const index = plugins.findIndex(({ name }) => name === LANGUAGE_SERVICE);
  if (index === -1) return overrides.length === 0 ? plugins : [...plugins, { name: LANGUAGE_SERVICE, overrides }];
  return plugins.map((plugin, at) => (at === index ? ownedBy(plugin, overrides) : plugin));
}

const refuse = (message: string) => () => new EffectScopeError({ message });

const readScope = Effect.fn("readScope")(function* (file: string) {
  const path = yield* Path.Path;
  const url = yield* path.toFileUrl(file).pipe(Effect.mapError(refuse(`cannot address ${file}`)));
  const loaded = yield* Effect.tryPromise({
    try: (): Promise<unknown> => import(url.href),
    catch: (cause) => new EffectScopeError({ message: `cannot load ${OXLINT_CONFIG}: ${String(cause)}` }),
  });
  const { default: config } = yield* decodeOxlintModule(loaded).pipe(Effect.mapError(refuse(`${OXLINT_CONFIG} exports no oxlint config as its default`)));
  return serviceOverrides(config.overrides ?? []);
});

const rewritten = Effect.fn("rewritten")(function* (tsconfig: JsonObject, overrides: readonly ServiceOverride[]) {
  const compilerOptions = yield* decodeObject(tsconfig["compilerOptions"] ?? {}).pipe(Effect.mapError(refuse(`${TSCONFIG} holds compilerOptions that is not an object`)));
  const plugins = yield* decodePlugins(compilerOptions["plugins"] ?? []).pipe(Effect.mapError(refuse(`${TSCONFIG} holds compilerOptions.plugins that is not a list of objects`)));
  const next = withServiceOverrides(plugins, overrides);
  return next === plugins ? tsconfig : { ...tsconfig, compilerOptions: { ...compilerOptions, plugins: next } };
});

const effectScope = Effect.gen(function* () {
  const args = process.argv.slice(2);
  if (args.length > 1 || (args.length === 1 && args[0] !== CHECK)) return yield* new Usage({ message: USAGE });
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const root = (yield* git(["rev-parse", "--show-toplevel"])).trim();
  const tsconfigFile = path.join(root, TSCONFIG);
  if (!(yield* fs.exists(tsconfigFile))) {
    yield* Console.log(`${NAME}: no ${TSCONFIG}, so no language service holds the Effect paths`);
    return true;
  }
  const overrides = yield* readScope(path.join(root, OXLINT_CONFIG));
  const tsconfig = yield* decodeTsconfig(yield* fs.readFileString(tsconfigFile)).pipe(Effect.mapError(refuse(`${TSCONFIG} does not parse as a JSON object`)));
  const next = yield* rewritten(tsconfig, overrides);
  if (JSON.stringify(next) === JSON.stringify(tsconfig)) {
    yield* Console.log(`${NAME}: ${TSCONFIG} holds the Effect paths of ${OXLINT_CONFIG}`);
    return true;
  }
  if (args[0] === CHECK) {
    yield* Console.error(`${NAME}: the ${LANGUAGE_SERVICE} overrides in ${TSCONFIG} differ from the Effect paths of ${OXLINT_CONFIG}; run checks-effect-scope to rewrite them`);
    return false;
  }
  yield* fs.writeFileString(tsconfigFile, `${JSON.stringify(next, null, 2)}\n`);
  yield* Console.log(`${NAME}: wrote the Effect paths of ${OXLINT_CONFIG} to ${TSCONFIG}`);
  return true;
});

if (import.meta.main) runMain(NAME, effectScope);
