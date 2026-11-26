#!/usr/bin/env bun
import { Console, Effect, FileSystem, Path, Schema } from "effect";
import { git } from "../core/git.ts";
import { runMain, Usage } from "../core/main.ts";
import { hasMember, type Step, withMember, withoutMember } from "./jsonc-patch.ts";
import { EffectScopeError, globalExcludes, scopeGlobs, validateScopePaths } from "./effect-scope-paths.ts";
import { defineConfig, effectRules } from "./presets/oxlint.ts";
import severities from "./presets/effect.language-service.json" with { type: "json" };
import kitTsconfig from "../../tsconfig.effect.json" with { type: "json" };

export const OXLINT_CONFIG = "oxlint.config.ts";
export const TSCONFIG = "tsconfig.json";
export const LANGUAGE_SERVICE = "@effect/language-service";

const DEFAULT_EFFECT = true;

export const DEFAULT_OXLINT_CONFIG = [
  'import { defineConfig } from "@avi2dg/checks/oxlint";',
  "",
  `export default defineConfig({ effect: ${DEFAULT_EFFECT} });`,
  "",
].join("\n");

const NAME = "effect-scope";
const CHECK = "--check";
const USAGE = `usage: effect-scope.ts [${CHECK}]`;

const JsonObject = Schema.Record(Schema.String, Schema.Unknown);

type JsonObject = typeof JsonObject.Type;

const RuleSettings = Schema.Struct({
  rules: Schema.optionalKey(JsonObject),
  plugins: Schema.optionalKey(Schema.Array(Schema.String)),
});

const Override = Schema.Struct({
  ...RuleSettings.fields,
  files: Schema.Array(Schema.String),
  excludeFiles: Schema.optionalKey(Schema.Array(Schema.String)),
});

const Oxlint = Schema.Struct({
  ...RuleSettings.fields,
  overrides: Schema.optionalKey(Schema.Array(Override)),
  ignorePatterns: Schema.optionalKey(Schema.Array(Schema.String)),
  extends: Schema.optionalKey(Schema.Array(Schema.String)),
  categories: Schema.optionalKey(JsonObject),
});
const OxlintModule = Schema.Struct({ default: Oxlint });

const decodeOxlintModule = Schema.decodeUnknownEffect(OxlintModule);
const decodeObject = Schema.decodeUnknownEffect(JsonObject);
const decodePlugins = Schema.decodeUnknownEffect(Schema.Array(JsonObject));

export type ServiceOverride = {
  readonly include: readonly string[];
  readonly exclude?: readonly string[];
  readonly options: { readonly diagnosticSeverity: Readonly<Partial<Record<ScopedDiagnostic, Severity>>> };
};

type ScopedDiagnostic = keyof typeof severities.diagnosticSeverity;
type Severity = "off" | "warning" | "error";

const EFFECT_RULE_NAMES = Object.keys(effectRules([]).rules ?? {});
const PAIRS = {
  oxc: { rule: "no-async-await", diagnostic: "asyncFunction" },
  promise: { rule: "avoid-new", diagnostic: "newPromise" },
} as const satisfies Readonly<Record<string, { readonly rule: string; readonly diagnostic: ScopedDiagnostic }>>;

const ruleNames = (plugin: string, rule: string) => [rule, `${plugin}/${rule}`, `eslint-plugin-${plugin}/${rule}`];

const SERVICE: readonly [Step, ...Step[]] = ["compilerOptions", "plugins", { name: LANGUAGE_SERVICE }];

const SERVICE_OVERRIDES: readonly [Step, ...Step[]] = [...SERVICE, "overrides"];

const SERVICE_SEVERITY: readonly [Step, ...Step[]] = [...SERVICE, "diagnosticSeverity"];

type ConfigLoad = "installed" | "allow-uninstalled-default";

const KIT_SEVERITY = kitTsconfig.compilerOptions.plugins.find(({ name }) => name === LANGUAGE_SERVICE)?.diagnosticSeverity ?? {};

function severityOf(setting: unknown): Severity | undefined {
  const severity: unknown = Array.isArray(setting) ? setting[0] : setting;
  if (severity === "off" || severity === "allow" || severity === 0) return "off";
  if (severity === "warn" || severity === 1) return "warning";
  if (severity === "error" || severity === "deny" || severity === 2) return "error";
  return undefined;
}

const SCOPED_DEFAULTS = Object.fromEntries(
  Object.entries(severities.diagnosticSeverity).map(([rule, severity]) => [rule, severityOf(severity)]),
);

function diagnosticSeverityOf({ rules = {}, plugins = [] }: typeof RuleSettings.Type, basePlugins: readonly string[]) {
  const namesEffectScope = EFFECT_RULE_NAMES.every((rule) => rule in rules);
  const allOff = namesEffectScope && EFFECT_RULE_NAMES.every((rule) => severityOf(rules[rule]) === "off");
  const diagnosticSeverity: Partial<Record<ScopedDiagnostic, Severity>> = namesEffectScope
    ? Object.fromEntries(Object.entries(SCOPED_DEFAULTS).map(([key, severity]) => [key, allOff ? "off" : severity]))
    : {};
  for (const [plugin, { rule, diagnostic }] of Object.entries(PAIRS)) {
    delete diagnosticSeverity[diagnostic];
    if (!basePlugins.includes(plugin) && !plugins.includes(plugin)) continue;
    const setting = Object.entries(rules).findLast(([key]) => ruleNames(plugin, rule).includes(key));
    const severity = severityOf(setting?.[1]);
    if (severity !== undefined) diagnosticSeverity[diagnostic] = severity;
  }
  return diagnosticSeverity;
}

export function serviceOverrides(overrides: readonly (typeof Override.Type)[], basePlugins: readonly string[] = ["oxc"]): readonly ServiceOverride[] {
  return overrides.flatMap((override) => {
    const diagnosticSeverity = diagnosticSeverityOf(override, basePlugins);
    const { files: include, excludeFiles: exclude = [] } = override;
    if (include.length === 0 || Object.keys(diagnosticSeverity).length === 0) return [];
    return [{ include, ...(exclude.length === 0 ? {} : { exclude }), options: { diagnosticSeverity } }];
  });
}

export function withServiceOverrides(tsconfig: string, overrides: readonly ServiceOverride[]): string {
  if (!hasMember(tsconfig, SERVICE)) return overrides.length === 0 ? tsconfig : withMember(tsconfig, SERVICE, { diagnosticSeverity: KIT_SEVERITY, overrides });
  const paths = overrides.length === 0 ? withoutMember(tsconfig, SERVICE_OVERRIDES) : withMember(tsconfig, SERVICE_OVERRIDES, overrides);
  const withoutGlobalScope = Object.keys(SCOPED_DEFAULTS).reduce((text, key) => withoutMember(text, [...SERVICE_SEVERITY, key]), paths);
  return Object.entries(KIT_SEVERITY).reduce((text, [key, severity]) => withMember(text, [...SERVICE_SEVERITY, key], severity), withoutGlobalScope);
}

const refuse = (message: string) => () => new EffectScopeError({ message });

const importOxlint = Effect.fn("importOxlint")(function* (file: string) {
  const path = yield* Path.Path;
  const url = yield* path.toFileUrl(file).pipe(Effect.mapError(refuse(`cannot address ${file}`)));
  return yield* Effect.tryPromise({
    try: (): Promise<unknown> => import(url.href),
    catch: (cause) => new EffectScopeError({ message: `cannot load ${OXLINT_CONFIG}: ${String(cause)}` }),
  });
});

const loadOxlint = Effect.fn("loadOxlint")(function* (file: string, mode: ConfigLoad) {
  const loaded = yield* importOxlint(file).pipe(Effect.catch((error) => Effect.gen(function* () {
    if (mode === "installed") return yield* error;
    const text = yield* (yield* FileSystem.FileSystem).readFileString(file);
    if (text !== DEFAULT_OXLINT_CONFIG) return yield* error;
    // Fresh setup can run before the consumer can import the kit.
    return { default: defineConfig({ effect: DEFAULT_EFFECT }) };
  })));
  const { default: config } = yield* decodeOxlintModule(loaded).pipe(Effect.mapError(refuse(`${OXLINT_CONFIG} exports no oxlint config as its default`)));
  return config;
});

const SCOPED_RULE_NAMES = new Set([...EFFECT_RULE_NAMES, ...Object.entries(PAIRS).flatMap(([plugin, { rule }]) => ruleNames(plugin, rule))]);

const validateRuleSeverities = Effect.fn("validateRuleSeverities")(function* (settings: readonly (typeof RuleSettings.Type)[]) {
  for (const { rules = {} } of settings) {
    for (const [rule, setting] of Object.entries(rules)) {
      if (SCOPED_RULE_NAMES.has(rule) && severityOf(setting) === undefined) {
        return yield* new EffectScopeError({ message: `oxlint rule ${rule} has an unsupported severity; use off, allow, warn, error, deny, 0, 1, or 2` });
      }
    }
  }
});

const readScope = Effect.fn("readScope")(function* (root: string, mode: ConfigLoad) {
  const file = (yield* Path.Path).join(root, OXLINT_CONFIG);
  const config = yield* loadOxlint(file, mode);
  const base: typeof Override.Type = { ...config, files: ["**/*"] };
  const settings = [base, ...(config.overrides ?? [])];
  yield* validateRuleSeverities(settings);
  const overrides = serviceOverrides(settings, config.plugins);
  if (overrides.length === 0) return [];
  if ((config.extends?.length ?? 0) > 0) {
    return yield* new EffectScopeError({ message: "oxlint extends may change the Effect scope; put those rules in oxlint.config.ts instead" });
  }
  for (const category of ["style", "restriction"]) {
    if (category in (config.categories ?? {}) && severityOf(config.categories?.[category]) !== "off") {
      return yield* new EffectScopeError({ message: `oxlint ${category} category may enable paired Effect rules; set those rules by name instead` });
    }
  }
  const translated = yield* Effect.forEach(overrides, ({ include, exclude = [], options }) => Effect.gen(function* () {
    return { include: yield* scopeGlobs(include, "oxlint files"), exclude: yield* scopeGlobs(exclude, "oxlint excludeFiles"), options };
  }));
  const ignored = yield* globalExcludes(root, config.ignorePatterns ?? [], translated.flatMap(({ include }) => include));
  yield* validateScopePaths(root, translated, ignored);
  return translated.map(({ include, exclude, options }) => {
    const excluded = [...new Set([...exclude, ...ignored])];
    return { include, ...(excluded.length === 0 ? {} : { exclude: excluded }), options };
  });
});

const placeOfService = Effect.fn("placeOfService")(function* (tsconfig: JsonObject) {
  const compilerOptions = yield* decodeObject("compilerOptions" in tsconfig ? tsconfig["compilerOptions"] : {}).pipe(Effect.mapError(refuse(`${TSCONFIG} holds compilerOptions that is not an object`)));
  const plugins = yield* decodePlugins("plugins" in compilerOptions ? compilerOptions["plugins"] : []).pipe(Effect.mapError(refuse(`${TSCONFIG} holds compilerOptions.plugins that is not a list of objects`)));
  const service = plugins.find(({ name }) => name === LANGUAGE_SERVICE) ?? {};
  yield* decodeObject("diagnosticSeverity" in service ? service["diagnosticSeverity"] : {}).pipe(Effect.mapError(refuse(`${TSCONFIG} holds a ${LANGUAGE_SERVICE} diagnosticSeverity that is not an object`)));
});

export const scopedTsconfig = Effect.fn("scopedTsconfig")(function* (root: string, text: string, mode: ConfigLoad = "installed") {
  const unparsed = refuse(`${TSCONFIG} does not parse as a JSONC object`);
  const tsconfig = yield* Effect.try({ try: () => Bun.JSONC.parse(text), catch: unparsed }).pipe(Effect.flatMap(decodeObject), Effect.mapError(unparsed));
  yield* placeOfService(tsconfig);
  return withServiceOverrides(text, yield* readScope(root, mode));
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
  const text = yield* fs.readFileString(tsconfigFile);
  const written = yield* scopedTsconfig(root, text);
  if (written === text) {
    yield* Console.log(`${NAME}: ${TSCONFIG} holds the Effect paths of ${OXLINT_CONFIG} and the kit's severities`);
    return true;
  }
  if (args[0] === CHECK) {
    yield* Console.error(`${NAME}: the ${LANGUAGE_SERVICE} entry in ${TSCONFIG} differs from the Effect paths of ${OXLINT_CONFIG} or the kit's severities; run checks-effect-scope to rewrite them`);
    return false;
  }
  yield* fs.writeFileString(tsconfigFile, written);
  yield* Console.log(`${NAME}: wrote the Effect paths of ${OXLINT_CONFIG} and the kit's severities to ${TSCONFIG}`);
  return true;
});

if (import.meta.main) runMain(NAME, effectScope);
