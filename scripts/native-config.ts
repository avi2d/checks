import { Effect, FileSystem, Path, Schema } from "effect";
import { git } from "./git.ts";
import { SIZE_RULES, TESTS_DIRECTORY, type Budget, type Size } from "./size-rules.ts";

export const Identity = Schema.Struct({ name: Schema.NonEmptyString, email: Schema.NonEmptyString });
export type Identity = typeof Identity.Type;

export const Library = Schema.Struct({
  name: Schema.String.check(Schema.isPattern(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)),
  package: Schema.NonEmptyString,
  repository: Schema.NonEmptyString,
  tag: Schema.String.check(Schema.isPattern(/\{version\}/)),
  path: Schema.optionalKey(Schema.String.check(Schema.isPattern(/^(?:[\w.@+-]+\/)*[\w.@+-]+\.\w+$/))),
});
export type Library = typeof Library.Type;

const VendorSources = Schema.Array(Library).check(
  Schema.makeFilter((libraries) => {
    const names = libraries.map(({ name }) => name);
    const repeated = names.find((name, index) => names.indexOf(name) !== index);
    return repeated === undefined || `vendorSources names ${repeated} more than once`;
  }),
);

const Package = Schema.Struct({
  vendorSources: Schema.optionalKey(VendorSources),
});

export class NativeConfigUnreadable extends Schema.TaggedError<NativeConfigUnreadable>()("NativeConfigUnreadable", {
  message: Schema.String,
}) {}

export const readVendorSources = Effect.fn("readVendorSources")(function* (root: string) {
  const path = (yield* Path.Path).join(root, "package.json");
  const text = yield* (yield* FileSystem.FileSystem).readFileString(path).pipe(
    Effect.mapError((cause) => new NativeConfigUnreadable({ message: `cannot read ${path}: ${cause.message}` })),
  );
  const manifest = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Package))(text).pipe(
    Effect.mapError((cause) => new NativeConfigUnreadable({ message: `${path}: ${cause.message}` })),
  );
  return manifest.vendorSources ?? [];
});

export const MODES = ["tutorial", "how-to", "reference", "explanation"] as const;
export type Mode = (typeof MODES)[number];

const RuleValue = Schema.Union([
  Schema.Literals(["off", "error", "warn"]),
  Schema.Tuple([Schema.Literal("error"), Schema.Struct({ max: Schema.Int.check(Schema.isGreaterThan(0)) })]),
]);
const Override = Schema.Struct({
  files: Schema.Array(Schema.String),
  rules: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)),
});
const Oxlint = Schema.Struct({
  rules: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)),
  overrides: Schema.optionalKey(Schema.Array(Override)),
});

const budgetOf = Effect.fn("budgetOf")(function* (rules: Readonly<Record<string, unknown>>) {
  const limits: [string, number][] = [];
  for (const { key, rule, ...rest } of SIZE_RULES) {
    const name = "plugin" in rest ? `${rest.plugin}/${rule}` : rule;
    const raw = rules[name];
    if (raw === undefined) continue;
    const value = yield* Schema.decodeUnknownEffect(RuleValue)(raw).pipe(
      Effect.mapError((cause) => new NativeConfigUnreadable({ message: `invalid oxlint rule ${name}: ${cause.message}` })),
    );
    if (Array.isArray(value)) limits.push([key, value[1].max]);
  }
  return Object.fromEntries(limits) satisfies Budget;
});

export const readSizeRules = Effect.fn("readSizeRules")(function* (root: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = (yield* Path.Path).join(root, ".oxlintrc.json");
  if (!(yield* fs.exists(path))) return undefined;
  const text = yield* fs.readFileString(path);
  const config = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Oxlint))(text).pipe(
    Effect.mapError((cause) => new NativeConfigUnreadable({ message: `${path}: ${cause.message}` })),
  );
  const sized = (config.overrides ?? []).filter(({ rules }) => rules !== undefined && SIZE_RULES.some(({ rule, ...rest }) =>
    ("plugin" in rest ? `${rest.plugin}/${rule}` : rule) in rules,
  ));
  for (const { files } of sized) {
    const testPaths = files.filter((glob) => glob.startsWith(`${TESTS_DIRECTORY}/`));
    if (testPaths.length > 0 && testPaths.length !== files.length) {
      return yield* new NativeConfigUnreadable({ message: `${path}: size override mixes tests and production paths` });
    }
  }
  const production = sized.filter(({ files }) => !files.every((glob) => glob.startsWith(`${TESTS_DIRECTORY}/`)));
  const tests = sized.filter(({ files }) => files.every((glob) => glob.startsWith(`${TESTS_DIRECTORY}/`)));
  if (production.length === 0 && tests.length === 0 && config.rules === undefined) return undefined;
  const productionFiles = production.flatMap(({ files }) => files);
  if (productionFiles.length === 0) {
    return yield* new NativeConfigUnreadable({ message: `${path}: size rules have no production override with files` });
  }
  for (const glob of productionFiles) {
    const files = yield* git(["ls-files", "--", `:(glob)${glob}`], root);
    if (files.trim() === "") {
      return yield* new NativeConfigUnreadable({ message: `${path}: production override ${glob} matches no tracked file` });
    }
  }
  const productionBudget = yield* budgetOf({ ...config.rules, ...production.reduce((rules, entry) => ({ ...rules, ...entry.rules }), {}) });
  const testsBudget = yield* budgetOf({ ...config.rules, ...tests.reduce((rules, entry) => ({ ...rules, ...entry.rules }), {}) });
  return {
    production: productionFiles,
    size: { applies: "ratchet", production: productionBudget, tests: testsBudget } satisfies Size,
  };
});
