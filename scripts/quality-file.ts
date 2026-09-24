import { Console, Effect, FileSystem, JsonSchema, Path, Schema } from "effect";
import { LintGates, QUALITY_FILE } from "./gates.ts";

const SEGMENT = String.raw`(?!\.\.?(?:/|$))(?:\*\*|(?:[\w.@+-]|\*(?!\*))+)`;

// oxlint matches a glob without a slash against a file's name at any depth, where tsc, the
// language service and git match it at the root alone, so a glob names a directory first.
const PathGlob = Schema.String.check(
  Schema.isPattern(new RegExp(`^${SEGMENT}(?:/${SEGMENT})+$`), {
    expected: "a glob from the repository root such as src/**/*.ts: a directory first, * within a segment, ** as a whole one",
  }),
).annotate({
  identifier: "PathGlob",
  description:
    "A glob from the repository root that oxlint, the Effect language service and git read alike: a directory first, * within a segment, ** as a whole one, and no braces, ?, [ or leading ./",
});

const Command = Schema.NonEmptyString.annotate({ identifier: "Command" });

const RuleName = Schema.String.check(
  Schema.isPattern(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, { expected: "a Rule name in kebab case" }),
).annotate({ identifier: "RuleName" });

export const Identity = Schema.Struct({ name: Schema.NonEmptyString, email: Schema.NonEmptyString }).annotate({
  identifier: "Identity",
});
export type Identity = typeof Identity.Type;

const CommitIdentity = Schema.Struct({
  authors: Schema.NonEmptyArray(Identity).annotate({
    description: "The identities allowed to author and commit, in place of the kit's default owner",
  }),
});

const Gates = Schema.Struct({
  ci: Schema.optionalKey(
    Schema.NonEmptyArray(Command).annotate({
      description: "The commands CI runs on every pull request to the default branch, each one plain command",
    }),
  ),
  scheduled: Schema.optionalKey(
    Schema.Array(Command).annotate({ description: "The commands a cron-scheduled workflow runs" }),
  ),
  lint: Schema.optionalKey(LintGates),
});

const EffectSources = Schema.Struct({
  paths: Schema.NonEmptyArray(PathGlob).annotate({
    description: "Where source is written in Effect, held to the Effect rules of oxlint and the language service",
  }),
  exempt: Schema.optionalKey(
    Schema.Array(PathGlob).annotate({ description: "Files under paths the Effect rules pass over" }),
  ),
});

const Sources = Schema.Struct({
  production: Schema.optionalKey(
    Schema.Array(PathGlob).annotate({ description: "The source the repository ships, as against tests and tooling" }),
  ),
  effect: Schema.optionalKey(EffectSources),
});

const AgentRules = Schema.Struct({
  on: Schema.optionalKey(Schema.Array(RuleName).annotate({ description: "Catalogued Rules switched on here" })),
  off: Schema.optionalKey(Schema.Array(RuleName).annotate({ description: "Catalogued Rules switched off here" })),
}).check(
  Schema.makeFilter(({ on = [], off = [] }) => {
    const both = on.filter((rule) => off.includes(rule));
    return both.length === 0 || `switches ${both.join(", ")} both on and off`;
  }),
);

export const Quality = Schema.Struct({
  $schema: Schema.optionalKey(Schema.String),
  defaultBranch: Schema.optionalKey(
    Schema.NonEmptyString.annotate({ description: "The branch pull requests merge into; main when absent" }),
  ),
  gates: Schema.optionalKey(Gates),
  commitIdentity: Schema.optionalKey(CommitIdentity),
  sources: Schema.optionalKey(Sources),
  agentRules: Schema.optionalKey(AgentRules),
}).annotate({
  title: QUALITY_FILE,
  description: "What a repository has opted into from @avi2dg/checks, read by its bins and agent Rule selection",
});
export type Quality = typeof Quality.Type;

const LegacyManifest = Schema.Struct({
  ciWiring: Schema.optionalKey(
    Schema.Struct({
      gates: Schema.optionalKey(Schema.NonEmptyArray(Command)),
      scheduled: Schema.optionalKey(Schema.Array(Command)),
      lintGates: Schema.optionalKey(LintGates),
      defaultBranch: Schema.optionalKey(Schema.NonEmptyString),
    }),
  ),
  commitIdentity: Schema.optionalKey(CommitIdentity),
});
type LegacyManifest = typeof LegacyManifest.Type;

const LEGACY_KEYS = ["ciWiring", "commitIdentity"] as const;

export type LegacyDeclaration = {
  readonly keys: readonly (typeof LEGACY_KEYS)[number][];
  readonly quality: Quality;
};

export class QualityUnreadable extends Schema.TaggedError<QualityUnreadable>()("QualityUnreadable", {
  message: Schema.String,
}) {}

const MANIFEST = "package.json";

export type Declared = {
  readonly source: typeof QUALITY_FILE | typeof MANIFEST;
  readonly quality: Quality;
};

const decodeQualityJson = Schema.decodeUnknownEffect(Schema.fromJsonString(Quality), { onExcessProperty: "error" });
const decodeManifestJson = Schema.decodeUnknownEffect(Schema.fromJsonString(LegacyManifest));

export const decodeQuality = (text: string, source: string): Effect.Effect<Quality, QualityUnreadable> =>
  decodeQualityJson(text).pipe(Effect.mapError((cause) => new QualityUnreadable({ message: `${source}: ${cause.message}` })));

function fromLegacy({ ciWiring, commitIdentity }: LegacyManifest): Quality {
  const gates = {
    ...(ciWiring?.gates === undefined ? {} : { ci: ciWiring.gates }),
    ...(ciWiring?.scheduled === undefined ? {} : { scheduled: ciWiring.scheduled }),
    ...(ciWiring?.lintGates === undefined ? {} : { lint: ciWiring.lintGates }),
  };
  return {
    ...(ciWiring?.defaultBranch === undefined ? {} : { defaultBranch: ciWiring.defaultBranch }),
    ...(Object.keys(gates).length === 0 ? {} : { gates }),
    ...(commitIdentity === undefined ? {} : { commitIdentity }),
  };
}

export const decodeManifest = (text: string, source: string): Effect.Effect<LegacyDeclaration, QualityUnreadable> =>
  decodeManifestJson(text).pipe(
    Effect.map((manifest) => ({
      keys: LEGACY_KEYS.filter((key) => manifest[key] !== undefined),
      quality: fromLegacy(manifest),
    })),
    Effect.mapError((cause) => new QualityUnreadable({ message: `${source}: ${cause.message}` })),
  );

const UNDECLARED: LegacyDeclaration = { keys: [], quality: {} };

export const readQuality = Effect.fn("readQuality")(function* (root: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const read = (file: string) =>
    fs
      .readFileString(path.join(root, file))
      .pipe(Effect.mapError((cause) => new QualityUnreadable({ message: `cannot read ${file}: ${cause.message}` })));

  const legacy = (yield* fs.exists(path.join(root, MANIFEST)))
    ? yield* decodeManifest(yield* read(MANIFEST), MANIFEST)
    : UNDECLARED;
  const keys = legacy.keys.join(" and ");
  if (yield* fs.exists(path.join(root, QUALITY_FILE))) {
    if (legacy.keys.length > 0) {
      return yield* new QualityUnreadable({
        message: `${MANIFEST} still sets ${keys}, which ${QUALITY_FILE} replaces; move what it holds there`,
      });
    }
    return { source: QUALITY_FILE, quality: yield* decodeQuality(yield* read(QUALITY_FILE), QUALITY_FILE) } satisfies Declared;
  }
  if (legacy.keys.length > 0) {
    const them = legacy.keys.length === 1 ? "it" : "them";
    yield* Console.error(`${MANIFEST} sets ${keys}, which a later minor release stops reading; move ${them} into ${QUALITY_FILE}`);
  }
  return { source: MANIFEST, quality: legacy.quality } satisfies Declared;
});

export function renderJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function qualityJsonSchema(): JsonSchema.JsonSchema {
  const { schema, definitions } = Schema.toJsonSchemaDocument(Quality, { onExcessProperty: "error" });
  return { $schema: JsonSchema.META_SCHEMA_URI_DRAFT_2020_12, ...schema, $defs: definitions };
}
