#!/usr/bin/env bun
import { Console, Effect, FileSystem, Path, Schema } from "effect";
import { git } from "../core/git.ts";
import { runMain, Usage } from "../core/main.ts";
import { hasMember, type Step, withMember, withoutMember } from "./jsonc-patch.ts";
import { effectRules } from "./presets/oxlint.ts";
import severities from "./presets/effect.language-service.json" with { type: "json" };
import kitTsconfig from "../../tsconfig.effect.json" with { type: "json" };

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
const decodeObject = Schema.decodeUnknownEffect(JsonObject);
const decodePlugins = Schema.decodeUnknownEffect(Schema.Array(JsonObject));

export type ServiceOverride = {
  readonly include: readonly string[];
  readonly exclude?: readonly string[];
  readonly options: typeof severities;
};

const EFFECT_RULES = JSON.stringify(effectRules([]).rules);

const SERVICE: readonly [Step, ...Step[]] = ["compilerOptions", "plugins", { name: LANGUAGE_SERVICE }];

const SERVICE_OVERRIDES: readonly [Step, ...Step[]] = [...SERVICE, "overrides"];

const KIT_SEVERITY = kitTsconfig.compilerOptions.plugins.find(({ name }) => name === LANGUAGE_SERVICE)?.diagnosticSeverity;

export function serviceOverrides(overrides: readonly (typeof Override.Type)[]): readonly ServiceOverride[] {
  return overrides
    .filter(({ rules }) => JSON.stringify(rules) === EFFECT_RULES)
    .map(({ files, excludeFiles = [] }) => (excludeFiles.length === 0 ? { include: files, options: severities } : { include: files, exclude: excludeFiles, options: severities }));
}

export function withServiceOverrides(tsconfig: string, overrides: readonly ServiceOverride[]): string {
  if (overrides.length === 0) return withoutMember(tsconfig, SERVICE_OVERRIDES);
  if (hasMember(tsconfig, SERVICE)) return withMember(tsconfig, SERVICE_OVERRIDES, overrides);
  return withMember(tsconfig, SERVICE, { diagnosticSeverity: KIT_SEVERITY, overrides });
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

const pluginsOf = Effect.fn("pluginsOf")(function* (tsconfig: JsonObject) {
  const compilerOptions = yield* decodeObject("compilerOptions" in tsconfig ? tsconfig["compilerOptions"] : {}).pipe(Effect.mapError(refuse(`${TSCONFIG} holds compilerOptions that is not an object`)));
  return yield* decodePlugins("plugins" in compilerOptions ? compilerOptions["plugins"] : []).pipe(Effect.mapError(refuse(`${TSCONFIG} holds compilerOptions.plugins that is not a list of objects`)));
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
  const text = yield* fs.readFileString(tsconfigFile);
  const unparsed = refuse(`${TSCONFIG} does not parse as a JSONC object`);
  const tsconfig = yield* Effect.try({ try: () => Bun.JSONC.parse(text), catch: unparsed }).pipe(Effect.flatMap(decodeObject), Effect.mapError(unparsed));
  yield* pluginsOf(tsconfig);
  const written = withServiceOverrides(text, overrides);
  if (written === text) {
    yield* Console.log(`${NAME}: ${TSCONFIG} holds the Effect paths of ${OXLINT_CONFIG}`);
    return true;
  }
  if (args[0] === CHECK) {
    yield* Console.error(`${NAME}: the ${LANGUAGE_SERVICE} overrides in ${TSCONFIG} differ from the Effect paths of ${OXLINT_CONFIG}; run checks-effect-scope to rewrite them`);
    return false;
  }
  yield* fs.writeFileString(tsconfigFile, written);
  yield* Console.log(`${NAME}: wrote the Effect paths of ${OXLINT_CONFIG} to ${TSCONFIG}`);
  return true;
});

if (import.meta.main) runMain(NAME, effectScope);
