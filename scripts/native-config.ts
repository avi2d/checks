import { Effect, FileSystem, Path, Schema } from "effect";
import { git } from "./git.ts";
import { anyDepth, isTestGlob, qualifiedName, SIZE_RULES, type Limits, type Scope, type Size } from "./size-rules.ts";

export class NativeConfigUnreadable extends Schema.TaggedError<NativeConfigUnreadable>()("NativeConfigUnreadable", {
  message: Schema.String,
}) {}

export const MODES = ["tutorial", "how-to", "reference", "explanation"] as const;
export type Mode = (typeof MODES)[number];

const RuleValue = Schema.Union([
  Schema.Literals(["off", "error", "warn"]),
  Schema.Tuple([Schema.Literal("error"), Schema.Struct({ max: Schema.Int.check(Schema.isGreaterThan(0)) })]),
]);
const Rules = Schema.Record(Schema.String, Schema.Unknown);
const Override = Schema.Struct({
  files: Schema.Array(Schema.String),
  excludeFiles: Schema.optionalKey(Schema.Array(Schema.String)),
  rules: Schema.optionalKey(Rules),
});
const Oxlint = Schema.Struct({
  rules: Schema.optionalKey(Rules),
  overrides: Schema.optionalKey(Schema.Array(Override)),
});

function namesSizeRule(rules: Readonly<Record<string, unknown>> | undefined): rules is Readonly<Record<string, unknown>> {
  return rules !== undefined && SIZE_RULES.some((entry) => qualifiedName(entry) in rules);
}

const limitsOf = Effect.fn("limitsOf")(function* (rules: Readonly<Record<string, unknown>>) {
  const limits: [string, number | "off"][] = [];
  for (const entry of SIZE_RULES) {
    const name = qualifiedName(entry);
    const raw = rules[name];
    if (raw === undefined) continue;
    const value = yield* Schema.decodeUnknownEffect(RuleValue)(raw).pipe(
      Effect.mapError((cause) => new NativeConfigUnreadable({ message: `invalid oxlint rule ${name}: ${cause.message}` })),
    );
    if (Array.isArray(value)) limits.push([entry.key, value[1].max]);
    else if (value === "off") limits.push([entry.key, "off"]);
  }
  return Object.fromEntries(limits) satisfies Limits;
});

export const readSizeRules = Effect.fn("readSizeRules")(function* (root: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = (yield* Path.Path).join(root, ".oxlintrc.json");
  if (!(yield* fs.exists(path))) return undefined;
  const text = yield* fs.readFileString(path);
  const config = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Oxlint))(text).pipe(
    Effect.mapError((cause) => new NativeConfigUnreadable({ message: `${path}: ${cause.message}` })),
  );
  const sized = (config.overrides ?? []).flatMap(({ files, excludeFiles = [], rules }) =>
    namesSizeRule(rules) ? [{ files: files.map(anyDepth), excludeFiles: excludeFiles.map(anyDepth), rules }] : [],
  );
  if (sized.length === 0 && !namesSizeRule(config.rules)) return undefined;
  for (const { files } of sized) {
    const tests = files.filter(isTestGlob);
    if (tests.length > 0 && tests.length !== files.length) {
      return yield* new NativeConfigUnreadable({ message: `${path}: size override mixes tests and production paths` });
    }
  }
  const production = sized.filter(({ files }) => !files.every(isTestGlob)).flatMap(({ files }) => files);
  if (production.length === 0) {
    return yield* new NativeConfigUnreadable({ message: `${path}: size rules have no production override with files` });
  }
  for (const glob of production) {
    const files = yield* git(["ls-files", "--", `:(glob)${glob}`], root);
    if (files.trim() === "") {
      return yield* new NativeConfigUnreadable({ message: `${path}: production override ${glob} matches no tracked file` });
    }
  }
  const scopes = yield* Effect.forEach(sized, ({ files, excludeFiles, rules }) =>
    limitsOf(rules).pipe(Effect.map((limits): Scope => ({ files, excludeFiles, limits }))),
  );
  return { production, size: { limits: yield* limitsOf(config.rules ?? {}), scopes } satisfies Size };
});
