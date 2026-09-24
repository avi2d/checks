// scripts/feature-rules.ts
import { Schema as Schema3 } from "effect";

// scripts/quality-file.ts
import { Console, Effect, FileSystem, JsonSchema, Path, Schema as Schema2 } from "effect";

// scripts/gates.ts
import { Schema } from "effect";
var EVERY_REPOSITORY = "every repository";
var QUALITY_FILE = "quality.json";
var TYPESCRIPT_SOURCE = { pathspecs: ["*.ts", "*.tsx"], content: "TypeScript source" };
var QUALITY_DECLARATION = { pathspecs: [QUALITY_FILE], content: `a ${QUALITY_FILE}` };
var KIT_GATES = [
  { bin: "checks-lint-coverage", script: "lint-coverage.sh", reads: "tree", appliesTo: TYPESCRIPT_SOURCE },
  { bin: "checks-test-layout", script: "test-layout.ts", reads: "tree", appliesTo: TYPESCRIPT_SOURCE },
  { bin: "checks-commit-identity", script: "commit-identity.ts", reads: "range", appliesTo: EVERY_REPOSITORY },
  { bin: "checks-comment-gate", script: "comment-gate.ts", reads: "range", appliesTo: EVERY_REPOSITORY },
  { bin: "checks-suppressions-ratchet", script: "suppressions-ratchet.ts", reads: "range", appliesTo: EVERY_REPOSITORY },
  { bin: "checks-ci-wiring", script: "ci-wiring.ts", reads: "tree", appliesTo: EVERY_REPOSITORY },
  { bin: "checks-quality", script: "quality.ts", reads: "tree", args: ["--check"], appliesTo: QUALITY_DECLARATION },
  { bin: "checks-size-budget", script: "size-budget.ts", reads: "range", appliesTo: TYPESCRIPT_SOURCE },
  { bin: "checks-feature-owners", script: "feature-owners.ts", reads: "range", appliesTo: TYPESCRIPT_SOURCE }
];
var UNCONDITIONAL = KIT_GATES.filter((gate) => gate.appliesTo === EVERY_REPOSITORY).map((gate) => gate.bin);
var LintGates = Schema.Array(Schema.Literals(KIT_GATES.map((gate) => gate.bin))).check(Schema.makeFilter((selected) => {
  const missing = UNCONDITIONAL.filter((bin) => !selected.includes(bin));
  if (missing.length === 0)
    return true;
  const verb = missing.length === 1 ? "applies" : "apply";
  return `checks-lint must run ${missing.join(", ")}, which ${verb} to ${EVERY_REPOSITORY}`;
}, { toJsonSchema: () => ({ allOf: UNCONDITIONAL.map((bin) => ({ contains: { const: bin } })) }) }));

// scripts/quality-file.ts
var SEGMENT = String.raw`(?!\.\.?(?:/|$))(?:\*\*|(?:[\w.@+-]|\*(?!\*))+)`;
var FILE = String.raw`(?:[\w.@+-]|\*(?!\*))*\.\w+`;
var PathGlob = Schema2.String.check(Schema2.isPattern(new RegExp(`^${SEGMENT}(?:/${SEGMENT})*/${FILE}$`), {
  expected: "a glob from the repository root such as src/**/*.ts: a directory first, * within a segment, ** as a whole one, a file name with an extension last"
})).annotate({
  identifier: "PathGlob",
  description: "A glob from the repository root that oxlint, the Effect language service and git read alike: a directory first, * within a segment, ** as a whole one, a file name with an extension last, and no braces, ?, [ or leading ./"
});
var LITERAL_SEGMENT = String.raw`(?!\.\.?(?:/|$))[\w.@+-]+`;
var DirectoryPath = Schema2.String.check(Schema2.isPattern(new RegExp(`^${LITERAL_SEGMENT}(?:/${LITERAL_SEGMENT})*$`), {
  expected: "a directory from the repository root such as src/billing, with no glob and no trailing slash"
})).annotate({ identifier: "DirectoryPath" });
var FilePath = Schema2.String.check(Schema2.isPattern(new RegExp(`^(?:${LITERAL_SEGMENT}/)*[\\w.@+-]*\\.\\w+$`), {
  expected: "a file from the repository root such as src/billing/index.ts, with no glob"
})).annotate({ identifier: "FilePath" });
var PROOF_DIRECTORY = "tests/e2e/";
var ProofPath = Schema2.String.check(Schema2.isPattern(new RegExp(`^${PROOF_DIRECTORY}(?:${LITERAL_SEGMENT}/)*[\\w.@+-]+\\.test\\.tsx?$`), {
  expected: `a test file under ${PROOF_DIRECTORY} such as ${PROOF_DIRECTORY}billing.test.ts`
})).annotate({ identifier: "ProofPath" });
var Command = Schema2.NonEmptyString.annotate({ identifier: "Command" });
var RuleName = Schema2.String.check(Schema2.isPattern(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, { expected: "a Rule name in kebab case" })).annotate({ identifier: "RuleName" });
var Identity = Schema2.Struct({ name: Schema2.NonEmptyString, email: Schema2.NonEmptyString }).annotate({
  identifier: "Identity"
});
var CommitIdentity = Schema2.Struct({
  authors: Schema2.NonEmptyArray(Identity).annotate({
    description: "The identities allowed to author and commit, in place of the kit's default owner"
  })
});
var Gates = Schema2.Struct({
  ci: Schema2.optionalKey(Schema2.NonEmptyArray(Command).annotate({
    description: "The commands CI runs on every pull request to the default branch, each one plain command"
  })),
  scheduled: Schema2.optionalKey(Schema2.Array(Command).annotate({ description: "The commands a cron-scheduled workflow runs" })),
  lint: Schema2.optionalKey(LintGates)
});
var EffectSources = Schema2.Struct({
  paths: Schema2.NonEmptyArray(PathGlob).annotate({
    description: "Where source is written in Effect, held to the Effect rules of oxlint and the language service"
  }),
  exempt: Schema2.optionalKey(Schema2.Array(PathGlob).annotate({ description: "Files under paths the Effect rules pass over" }))
});
var Sources = Schema2.Struct({
  production: Schema2.optionalKey(Schema2.Array(PathGlob).annotate({ description: "The source the repository ships, as against tests and tooling" })),
  effect: Schema2.optionalKey(EffectSources)
});
var LineBudget = Schema2.Int.check(Schema2.isGreaterThan(0));
var Size = Schema2.Struct({
  fileLines: LineBudget.annotate({ description: "The most lines a file may hold, blank and comment lines counted" }),
  functionLines: LineBudget.annotate({
    description: "The most lines a function may span, blank and comment lines counted"
  }),
  applies: Schema2.Literals(["changed", "all"]).annotate({
    description: "Which production files the budget holds: changed, the ones a range adds or changes; all, every one. The rest are reported as advisory"
  })
});
var Feature = Schema2.Struct({
  name: Schema2.String.check(Schema2.isPattern(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, { expected: "a feature name in kebab case" })).annotate({ description: "The owner the dependency rule and the change signal name" }),
  root: DirectoryPath.annotate({ description: "The directory the feature owns" }),
  entries: Schema2.NonEmptyArray(FilePath).annotate({
    description: "The files under root that code outside it imports the feature through"
  }),
  allowFrom: Schema2.optionalKey(Schema2.Array(PathGlob).annotate({
    description: "Files outside root that may import past its entries, such as a CLI or a harness; tests/ always may"
  })),
  proof: ProofPath.annotate({ description: "The end-to-end test that imports one of entries" })
}).check(Schema2.makeFilter(({ root, entries }) => {
  const outside = entries.filter((entry) => !entry.startsWith(`${root}/`));
  return outside.length === 0 || `lists ${outside.join(", ")} among its entries, outside its root ${root}`;
}));
function nests(outer, inner) {
  return outer === inner || inner.startsWith(`${outer}/`);
}
var Features = Schema2.Array(Feature).check(Schema2.makeFilter((features) => {
  const names = features.map((feature) => feature.name);
  const repeated = names.filter((name, index) => names.indexOf(name) !== index);
  if (repeated.length > 0)
    return `names ${[...new Set(repeated)].join(", ")} more than once`;
  for (const outer of features) {
    const inner = features.find((other) => other !== outer && nests(outer.root, other.root));
    if (inner !== undefined)
      return `gives ${inner.root} to both ${outer.name} and ${inner.name}`;
  }
  return true;
}));
var AgentRules = Schema2.Struct({
  on: Schema2.optionalKey(Schema2.Array(RuleName).annotate({ description: "Catalogued Rules switched on here" })),
  off: Schema2.optionalKey(Schema2.Array(RuleName).annotate({ description: "Catalogued Rules switched off here" }))
}).check(Schema2.makeFilter(({ on = [], off = [] }) => {
  const both = on.filter((rule) => off.includes(rule));
  return both.length === 0 || `switches ${both.join(", ")} both on and off`;
}));
var Quality = Schema2.Struct({
  $schema: Schema2.optionalKey(Schema2.String),
  defaultBranch: Schema2.optionalKey(Schema2.NonEmptyString.annotate({ description: "The branch pull requests merge into; main when absent" })),
  gates: Schema2.optionalKey(Gates),
  commitIdentity: Schema2.optionalKey(CommitIdentity),
  sources: Schema2.optionalKey(Sources),
  size: Schema2.optionalKey(Size.annotate({ description: "The line budget oxlint holds production files to, read by checks-size-budget" })),
  features: Schema2.optionalKey(Features.annotate({
    description: "The feature owners dependency-cruiser holds to their entries and checks-feature-owners maps a change to"
  })),
  changeSignal: Schema2.optionalKey(Schema2.Literal("advisory").annotate({
    description: "Report which feature owners a change touches, without failing on it"
  })),
  agentRules: Schema2.optionalKey(AgentRules)
}).annotate({
  title: QUALITY_FILE,
  description: "What a repository has opted into from @avi2dg/checks, read by its bins and agent Rule selection"
}).check(Schema2.makeFilter(({ size, sources }) => size === undefined || (sources?.production ?? []).length > 0 || "declares size, which holds nothing without sources.production", {
  toJsonSchema: () => ({
    if: { required: ["size"] },
    then: { required: ["sources"], properties: { sources: { required: ["production"], properties: { production: { minItems: 1 } } } } }
  })
}), Schema2.makeFilter(({ changeSignal, features = [] }) => changeSignal === undefined || features.length > 0 || "declares changeSignal, which maps a change to no owner without features", {
  toJsonSchema: () => ({
    if: { required: ["changeSignal"] },
    then: { required: ["features"], properties: { features: { minItems: 1 } } }
  })
}));
var LegacyManifest = Schema2.Struct({
  ciWiring: Schema2.optionalKey(Schema2.Struct({
    gates: Schema2.optionalKey(Schema2.NonEmptyArray(Command)),
    scheduled: Schema2.optionalKey(Schema2.Array(Command)),
    lintGates: Schema2.optionalKey(LintGates),
    defaultBranch: Schema2.optionalKey(Schema2.NonEmptyString)
  })),
  commitIdentity: Schema2.optionalKey(CommitIdentity)
});
var LEGACY_KEYS = ["ciWiring", "commitIdentity"];

class QualityUnreadable extends Schema2.TaggedError()("QualityUnreadable", {
  message: Schema2.String
}) {
}
var MANIFEST = "package.json";
var decodeQualityJson = Schema2.decodeUnknownEffect(Schema2.fromJsonString(Quality), { onExcessProperty: "error" });
var decodeManifestJson = Schema2.decodeUnknownEffect(Schema2.fromJsonString(LegacyManifest));
var decodeQuality = (text, source) => decodeQualityJson(text).pipe(Effect.mapError((cause) => new QualityUnreadable({ message: `${source}: ${cause.message}` })));
function fromLegacy({ ciWiring, commitIdentity }) {
  const gates = {
    ...ciWiring?.gates === undefined ? {} : { ci: ciWiring.gates },
    ...ciWiring?.scheduled === undefined ? {} : { scheduled: ciWiring.scheduled },
    ...ciWiring?.lintGates === undefined ? {} : { lint: ciWiring.lintGates }
  };
  return {
    ...ciWiring?.defaultBranch === undefined ? {} : { defaultBranch: ciWiring.defaultBranch },
    ...Object.keys(gates).length === 0 ? {} : { gates },
    ...commitIdentity === undefined ? {} : { commitIdentity }
  };
}
var decodeManifest = (text, source) => decodeManifestJson(text).pipe(Effect.map((manifest) => ({
  keys: LEGACY_KEYS.filter((key) => manifest[key] !== undefined),
  quality: fromLegacy(manifest)
})), Effect.mapError((cause) => new QualityUnreadable({ message: `${source}: ${cause.message}` })));
var UNDECLARED = { keys: [], quality: {} };
var readQuality = Effect.fn("readQuality")(function* (root) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const read = (file) => fs.readFileString(path.join(root, file)).pipe(Effect.mapError((cause) => new QualityUnreadable({ message: `cannot read ${file}: ${cause.message}` })));
  const legacy = (yield* fs.exists(path.join(root, MANIFEST))) ? yield* decodeManifest(yield* read(MANIFEST), MANIFEST) : UNDECLARED;
  const keys = legacy.keys.join(" and ");
  if (yield* fs.exists(path.join(root, QUALITY_FILE))) {
    if (legacy.keys.length > 0) {
      return yield* new QualityUnreadable({
        message: `${MANIFEST} still sets ${keys}, which ${QUALITY_FILE} replaces; move what it holds there`
      });
    }
    return { source: QUALITY_FILE, quality: yield* decodeQuality(yield* read(QUALITY_FILE), QUALITY_FILE) };
  }
  if (legacy.keys.length > 0) {
    const them = legacy.keys.length === 1 ? "it" : "them";
    yield* Console.error(`${MANIFEST} sets ${keys}, which a later minor release stops reading; move ${them} into ${QUALITY_FILE}`);
  }
  return { source: MANIFEST, quality: legacy.quality };
});

// scripts/feature-rules.ts
var TESTS = "^tests/";
function escaped(literal) {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
}
function globPattern(glob) {
  const segments = glob.split("/");
  const body = segments.map((segment, index) => {
    if (segment === "**")
      return "(?:[^/]+/)*";
    const pattern = segment.split("*").map(escaped).join("[^/]*");
    return index === segments.length - 1 ? pattern : `${pattern}/`;
  });
  return `^${body.join("")}$`;
}
function rulesFor(features) {
  return features.map(({ name, root, entries, allowFrom = [] }) => ({
    name: `feature-${name}-entries`,
    severity: "error",
    comment: `Outside ${root}/, ${name} is imported through ${entries.join(", ")}. Import one of those, or list the importer in the feature's allowFrom in quality.json.`,
    from: { pathNot: [`^${escaped(root)}/`, TESTS, ...allowFrom.map(globPattern)] },
    to: { path: `^${escaped(root)}/`, pathNot: entries.map((entry) => `^${escaped(entry)}$`) }
  }));
}
var decode = Schema3.decodeUnknownSync(Quality);
function featureRules(quality) {
  return rulesFor(decode(quality, { onExcessProperty: "error" }).features ?? []);
}
export {
  globPattern,
  featureRules
};
