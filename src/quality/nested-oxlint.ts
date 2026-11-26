#!/usr/bin/env bun
import { Console, Effect, FileSystem, Path, Schema } from "effect";
import { ChildProcessSpawner } from "effect/process";
import { collect, git } from "../core/git.ts";
import { runMain } from "../core/main.ts";
import { decodeSetting, loadSettings, NestedOxlintConfigs, SETTINGS_FILE } from "../core/settings.ts";

const NAME = "lint-coverage";

const KEY = "nestedOxlintConfigs";

const CONFIG_NAMES: readonly string[] = [".oxlintrc.json", ".oxlintrc.jsonc", "oxlint.config.ts", "oxlint.config.mts"];

const LINTED_SOURCE = /\.(?:tsx?|astro)$/;

const Rules = Schema.Record(Schema.String, Schema.Unknown);

type Rules = typeof Rules.Type;

const Block = Schema.Struct({
  files: Schema.Array(Schema.String),
  excludeFiles: Schema.optionalKey(Schema.NullOr(Schema.Array(Schema.String))),
  rules: Schema.optionalKey(Schema.NullOr(Rules)),
});

const Printed = Schema.Struct({ rules: Rules, overrides: Schema.optionalKey(Schema.Array(Block)) });

type Resolved = typeof Printed.Type;

const decodePrinted = Schema.decodeUnknownEffect(Schema.fromJsonString(Printed));

const decodeRawConfig = Schema.decodeUnknownEffect(Schema.Struct({ rules: Schema.optionalKey(Rules) }));

const decodeRawModule = Schema.decodeUnknownEffect(Schema.Struct({ default: Schema.Unknown }));

class NestedOxlintError extends Schema.TaggedError<NestedOxlintError>()("NestedOxlintError", {
  message: Schema.String,
}) {}

type Weakening = "off" | "down" | "options";

const WEAKENINGS: readonly Weakening[] = ["off", "down", "options"];

type Allowed = Readonly<Record<string, readonly string[]>>;

type WeakenedByConfig = ReadonlyMap<string, ReadonlyMap<string, Weakening>>;

const LEVELS: Readonly<Record<string, number>> = { off: 0, allow: 0, "0": 0, warn: 1, "1": 1, error: 2, deny: 2, "2": 2 };

function levelOf(setting: unknown): number {
  return LEVELS[String(Array.isArray(setting) ? setting[0] : setting)] ?? 0;
}

// oxlint prints a rule's options as one list nested beside the severity, where a config writes them flat.
function optionsOf(setting: unknown): string {
  return Array.isArray(setting) ? JSON.stringify(setting.slice(1).flat()) : "[]";
}

function canonicalRule(rule: string): string {
  return rule.replace(/^@typescript-eslint\//, "typescript/").replace(/^eslint\//, "").replace(/^eslint-plugin-([^/]+)\//, "$1/");
}

function matchesAny(globs: readonly string[] | null | undefined, file: string): boolean {
  return (globs ?? []).some((glob) => new Bun.Glob(glob.replace(/^\.\//, "")).match(file));
}

function effectiveRules({ rules, overrides = [] }: Resolved, file: string): ReadonlyMap<string, unknown> {
  const effective = new Map(Object.entries(rules));
  for (const { files, excludeFiles, rules: set } of overrides) {
    if (!matchesAny(files, file) || matchesAny(excludeFiles, file)) continue;
    for (const [rule, setting] of Object.entries(set ?? {})) effective.set(rule, setting);
  }
  return effective;
}

function weakeningOf(root: unknown, nested: unknown): Weakening | undefined {
  const rootLevel = levelOf(root);
  const nestedLevel = levelOf(nested);
  if (rootLevel === 0 || nestedLevel > rootLevel) return undefined;
  if (nestedLevel === 0) return "off";
  if (nestedLevel < rootLevel) return "down";
  return optionsOf(root) === optionsOf(nested) ? undefined : "options";
}

function strongerOf(first: Weakening | undefined, second: Weakening): Weakening {
  if (first === undefined) return second;
  return WEAKENINGS.indexOf(first) <= WEAKENINGS.indexOf(second) ? first : second;
}

function weakenRules(into: Map<string, Weakening>, root: ReadonlyMap<string, unknown>, nested: ReadonlyMap<string, unknown>): void {
  for (const [rule, setting] of root) {
    const weakening = weakeningOf(setting, nested.get(rule));
    if (weakening !== undefined) into.set(rule, strongerOf(into.get(rule), weakening));
  }
}

function directoryOf(config: string): string {
  return config.slice(0, config.lastIndexOf("/") + 1);
}

function nearestConfig(configs: readonly string[], file: string): string | undefined {
  return configs.filter((config) => file.startsWith(directoryOf(config))).toSorted((first, second) => second.length - first.length)[0];
}

const failed = (message: string) => (cause: unknown) => new NestedOxlintError({ message: `${message}: ${String(cause)}` });

const printConfig = Effect.fn("printConfig")(function* (root: string, config: string | undefined) {
  const oxlint = (yield* Path.Path).join(root, "node_modules", ".bin", "oxlint");
  const shown = config ?? "the root oxlint config";
  const args = config === undefined ? ["--print-config"] : ["-c", config, "--print-config"];
  const { stdout, stderr, exitCode } = yield* collect(oxlint, args, root).pipe(Effect.mapError(failed(`oxlint could not print ${shown}`)));
  if (exitCode !== ChildProcessSpawner.ExitCode(0)) return yield* new NestedOxlintError({ message: `oxlint could not print ${shown}:\n${stdout}${stderr}` });
  return yield* decodePrinted(stdout).pipe(Effect.mapError(failed(`oxlint printed ${shown} in a shape lint-coverage does not read`)));
});

const importDefault = Effect.fn("importDefault")(function* (file: string, config: string) {
  const loaded: unknown = yield* Effect.tryPromise({ try: (): Promise<unknown> => import(file), catch: failed(`cannot load ${config}`) });
  return (yield* decodeRawModule(loaded).pipe(Effect.mapError(failed(`${config} has no default export`)))).default;
});

const parseJsonc = Effect.fn("parseJsonc")(function* (file: string, config: string) {
  const text = yield* (yield* FileSystem.FileSystem).readFileString(file).pipe(Effect.mapError(failed(`cannot read ${config}`)));
  return yield* Effect.try({ try: (): unknown => Bun.JSONC.parse(text), catch: failed(`${config} does not parse as JSONC`) });
});

const rawRules = Effect.fn("rawRules")(function* (root: string, config: string) {
  const file = (yield* Path.Path).join(root, config);
  const raw = config.endsWith("json") || config.endsWith("jsonc") ? yield* parseJsonc(file, config) : yield* importDefault(file, config);
  return (yield* decodeRawConfig(raw).pipe(Effect.mapError(failed(`${config} sets rules that are not an object`)))).rules ?? {};
});

// oxlint --print-config leaves out each top-level rule of a JS plugin, so those come from the config itself.
function withPluginRules(printed: Resolved, raw: Rules): Resolved {
  const missing = Object.entries(raw).filter(([rule]) => !Object.hasOwn(printed.rules, canonicalRule(rule)));
  return { ...printed, rules: { ...printed.rules, ...Object.fromEntries(missing.map(([rule, setting]) => [canonicalRule(rule), setting])) } };
}

const resolveConfig = Effect.fn("resolveConfig")(function* (root: string, config: string | undefined, file: string | undefined) {
  const printed = yield* printConfig(root, config);
  return file === undefined ? printed : withPluginRules(printed, yield* rawRules(root, file));
});

const rootConfigFile = Effect.fn("rootConfigFile")(function* (root: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const present = yield* Effect.forEach(CONFIG_NAMES, (name) => fs.exists(path.join(root, name)).pipe(Effect.mapError(failed(`cannot read ${name}`))));
  return CONFIG_NAMES.find((_, index) => present[index]);
});

const readAllowed = Effect.fn("readAllowed")(function* (root: string) {
  const value = (yield* loadSettings(root))[KEY];
  if (value === undefined) return {};
  return yield* decodeSetting(KEY, NestedOxlintConfigs, value);
});

function isNestedConfig(file: string): boolean {
  return file.includes("/") && CONFIG_NAMES.includes(file.slice(file.lastIndexOf("/") + 1));
}

const weakenedBy = Effect.fn("weakenedBy")(function* (root: string, base: Resolved, config: string, files: readonly string[]) {
  const nested = yield* resolveConfig(root, config, config);
  const weakened = new Map<string, Weakening>();
  for (const file of files) weakenRules(weakened, effectiveRules(base, file), effectiveRules(nested, file.slice(directoryOf(config).length)));
  return weakened;
});

function unlistedLines(config: string, weakened: ReadonlyMap<string, Weakening>, listed: ReadonlySet<string>): readonly string[] {
  const unlisted = [...weakened].filter(([rule]) => !listed.has(rule));
  if (unlisted.length === 0) return [];
  const sorted = unlisted.toSorted(([ruleA, kindA], [ruleB, kindB]) => WEAKENINGS.indexOf(kindA) - WEAKENINGS.indexOf(kindB) || ruleA.localeCompare(ruleB));
  return [
    `${NAME}: ${config} turns off or down rules the root oxlint config sets:`,
    ...sorted.map(([rule, kind]) => `  ${kind}: ${rule}`),
    `  set each back in ${config}, or list it for ${config} under ${KEY} in ${SETTINGS_FILE}`,
  ];
}

function staleLines(weakenedByConfig: WeakenedByConfig, allowed: Allowed): readonly string[] {
  return Object.entries(allowed).flatMap(([config, rules]) => {
    const weakened = weakenedByConfig.get(config);
    if (weakened === undefined) return [`${NAME}: ${SETTINGS_FILE} ${KEY} names ${config}, which is not a tracked nested oxlint config`];
    const stale = rules.map(canonicalRule).filter((rule) => !weakened.has(rule));
    return stale.length === 0 ? [] : [`${NAME}: ${SETTINGS_FILE} ${KEY} lets ${config} turn off ${stale.join(", ")}, which it does not turn off or down`];
  });
}

function findings(weakenedByConfig: WeakenedByConfig, allowed: Allowed): readonly string[] {
  const unlisted = [...weakenedByConfig].flatMap(([config, weakened]) => unlistedLines(config, weakened, new Set((allowed[config] ?? []).map(canonicalRule))));
  return [...unlisted, ...staleLines(weakenedByConfig, allowed)];
}

const judge = Effect.gen(function* () {
  const root = (yield* git(["rev-parse", "--show-toplevel"])).trim();
  const tracked = (yield* git(["ls-files", "-z"], root)).split("\0").filter(Boolean).toSorted();
  const configs = tracked.filter(isNestedConfig);
  const allowed = yield* readAllowed(root);
  if (configs.length === 0 && Object.keys(allowed).length === 0) {
    yield* Console.log(`${NAME}: no nested oxlint config`);
    return true;
  }
  const base = yield* resolveConfig(root, undefined, yield* rootConfigFile(root));
  const sources = tracked.filter((file) => LINTED_SOURCE.test(file));
  const weakened = yield* Effect.forEach(configs, (config) =>
    Effect.map(weakenedBy(root, base, config, sources.filter((file) => nearestConfig(configs, file) === config)), (rules) => [config, rules] as const));
  const lines = findings(new Map(weakened), allowed);
  if (lines.length > 0) {
    yield* Console.log(lines.join("\n"));
    return false;
  }
  yield* Console.log(`${NAME}: ${configs.length} nested oxlint config(s) turn off or down only the rules ${SETTINGS_FILE} ${KEY} lists`);
  return true;
});

if (import.meta.main) runMain(NAME, judge);
