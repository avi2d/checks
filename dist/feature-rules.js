// scripts/feature-rules.ts
import { Schema as Schema4 } from "effect";

// scripts/quality-file.ts
import { Console, Effect, FileSystem, JsonSchema, Path, Schema as Schema3 } from "effect";

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
  { bin: "checks-docs", script: "docs.ts", reads: "range", appliesTo: EVERY_REPOSITORY },
  { bin: "checks-quality", script: "quality.ts", reads: "tree", args: ["--check"], appliesTo: QUALITY_DECLARATION },
  { bin: "checks-size-budget", script: "size-budget.ts", reads: "range", appliesTo: TYPESCRIPT_SOURCE },
  { bin: "checks-repetition", script: "repetition.ts", reads: "range", appliesTo: TYPESCRIPT_SOURCE },
  { bin: "checks-feature-owners", script: "feature-owners.ts", reads: "range", appliesTo: TYPESCRIPT_SOURCE },
  { bin: "checks-quarantine-clock", script: "quarantine-clock.ts", reads: "range", appliesTo: EVERY_REPOSITORY }
];
var UNCONDITIONAL = KIT_GATES.filter((gate) => gate.appliesTo === EVERY_REPOSITORY).map((gate) => gate.bin);
var LintGates = Schema.Array(Schema.Literals(KIT_GATES.map((gate) => gate.bin))).check(Schema.makeFilter((selected) => {
  const missing = UNCONDITIONAL.filter((bin) => !selected.includes(bin));
  if (missing.length === 0)
    return true;
  const verb = missing.length === 1 ? "applies" : "apply";
  return `checks-lint must run ${missing.join(", ")}, which ${verb} to ${EVERY_REPOSITORY}`;
}, { toJsonSchema: () => ({ allOf: UNCONDITIONAL.map((bin) => ({ contains: { const: bin } })) }) }));

// scripts/size-rules.ts
import { Schema as Schema2 } from "effect";
var TESTS_DIRECTORY = "tests";
var COUNTED = { skipBlankLines: false, skipComments: false };
var FILE_LINES = {
  key: "fileLines",
  rule: "max-lines",
  options: COUNTED,
  measured: /has too many lines \((\d+)\)/,
  limits: "The most lines a file may hold, blank and comment lines counted"
};
var FUNCTION_LINES = {
  key: "functionLines",
  rule: "max-lines-per-function",
  options: COUNTED,
  measured: /has too many lines \((\d+)\)/,
  limits: "The most lines a function may span, blank and comment lines counted"
};
var STATEMENTS = {
  key: "statements",
  rule: "max-statements",
  options: {},
  measured: /has too many statements \((\d+)\)/,
  limits: "The most statements a function may hold"
};
var COMPLEXITY = {
  key: "complexity",
  rule: "cognitive-complexity",
  plugin: "effect-channel",
  options: {},
  measured: /has a cognitive complexity of (\d+)/,
  limits: "The highest cognitive complexity a function may reach, a switch counted once"
};
var DEPTH = {
  key: "depth",
  rule: "max-depth",
  options: {},
  measured: /nested too deeply \((\d+)\)/,
  limits: "The deepest a block may nest inside a function"
};
var APPLIES = ["ratchet", "all"];
var SIZE_DEFAULTS = {
  applies: "ratchet",
  production: { fileLines: 400, functionLines: 100, statements: 30, complexity: 15, depth: 4 },
  tests: { fileLines: 600, statements: 50, complexity: 15, depth: 4 }
};
var Limit = Schema2.Int.check(Schema2.isGreaterThan(0));
function limit({ limits }, fallback) {
  return Schema2.optionalKey(Limit.annotate({ description: `${limits}; ${fallback} when absent` }));
}
var ProductionBudget = Schema2.Struct({
  fileLines: limit(FILE_LINES, SIZE_DEFAULTS.production.fileLines),
  functionLines: limit(FUNCTION_LINES, SIZE_DEFAULTS.production.functionLines),
  statements: limit(STATEMENTS, SIZE_DEFAULTS.production.statements),
  complexity: limit(COMPLEXITY, SIZE_DEFAULTS.production.complexity),
  depth: limit(DEPTH, SIZE_DEFAULTS.production.depth)
});
var TestBudget = Schema2.Struct({
  fileLines: limit(FILE_LINES, SIZE_DEFAULTS.tests.fileLines),
  statements: limit(STATEMENTS, SIZE_DEFAULTS.tests.statements),
  complexity: limit(COMPLEXITY, SIZE_DEFAULTS.tests.complexity),
  depth: limit(DEPTH, SIZE_DEFAULTS.tests.depth)
});
var Size = Schema2.Struct({
  applies: Schema2.optionalKey(Schema2.Literals(APPLIES).annotate({
    description: `Which production and test files the budget holds: ratchet, the ones a range adds or changes, to no more overrun per rule than at the range's base; all, every one. ${SIZE_DEFAULTS.applies} when absent. The rest are listed as advisory`,
    message: "Expected ratchet or all, and ratchet replaces changed"
  })),
  production: Schema2.optionalKey(ProductionBudget.annotate({
    description: `The budget of the files under sources.production, and of the files listed as advisory outside ${TESTS_DIRECTORY}/`
  })),
  tests: Schema2.optionalKey(TestBudget.annotate({ description: `The budget of the files under ${TESTS_DIRECTORY}/, which sets no limit on a function's lines` }))
}).annotate({
  description: "The size budget oxlint holds production and test files to, read by checks-size-budget",
  messageUnexpectedKey: "Expected only applies, production and tests, since each limit is set inside production or tests"
});

// scripts/quality-file.ts
var SEGMENT = String.raw`(?!\.\.?(?:/|$))(?:\*\*|(?:[\w.@+-]|\*(?!\*))+)`;
var FILE = String.raw`(?:[\w.@+-]|\*(?!\*))*\.\w+`;
var PathGlob = Schema3.String.check(Schema3.isPattern(new RegExp(`^${SEGMENT}(?:/${SEGMENT})*/${FILE}$`), {
  expected: "a glob from the repository root such as src/**/*.ts: a directory first, * within a segment, ** as a whole one, a file name with an extension last"
})).annotate({
  identifier: "PathGlob",
  description: "A glob from the repository root that oxlint, the Effect language service and git read alike: a directory first, * within a segment, ** as a whole one, a file name with an extension last, and no braces, ?, [ or leading ./"
});
var DocGlob = Schema3.String.check(Schema3.isPattern(new RegExp(`^(?:${SEGMENT}/)*${FILE}$`), {
  expected: "a glob from the repository root such as README.md or docs/**/*.md: * within a segment, ** as a whole one, a file name with an extension last"
})).annotate({
  identifier: "DocGlob",
  description: "A glob from the repository root that checks-docs reads: * within a segment, ** as a whole one, a file name with an extension last"
});
var LITERAL_SEGMENT = String.raw`(?!\.\.?(?:/|$))[\w.@+-]+`;
var DirectoryPath = Schema3.String.check(Schema3.isPattern(new RegExp(`^${LITERAL_SEGMENT}(?:/${LITERAL_SEGMENT})*$`), {
  expected: "a directory from the repository root such as src/billing, with no glob and no trailing slash"
})).annotate({ identifier: "DirectoryPath" });
var FilePath = Schema3.String.check(Schema3.isPattern(new RegExp(`^(?:${LITERAL_SEGMENT}/)*[\\w.@+-]*\\.\\w+$`), {
  expected: "a file from the repository root such as src/billing/index.ts, with no glob"
})).annotate({ identifier: "FilePath" });
var PROOF_DIRECTORY = "tests/e2e/";
var ProofPath = Schema3.String.check(Schema3.isPattern(new RegExp(`^${PROOF_DIRECTORY}(?:${LITERAL_SEGMENT}/)*[\\w.@+-]+\\.test\\.tsx?$`), {
  expected: `a test file under ${PROOF_DIRECTORY} such as ${PROOF_DIRECTORY}billing.test.ts`
})).annotate({ identifier: "ProofPath" });
var Command = Schema3.NonEmptyString.annotate({ identifier: "Command" });
var RuleName = Schema3.String.check(Schema3.isPattern(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, { expected: "a Rule name in kebab case" })).annotate({ identifier: "RuleName" });
var Identity = Schema3.Struct({ name: Schema3.NonEmptyString, email: Schema3.NonEmptyString }).annotate({
  identifier: "Identity"
});
var CommitIdentity = Schema3.Struct({
  authors: Schema3.NonEmptyArray(Identity).annotate({
    description: "The identities allowed to author and commit, in place of the kit's default owner"
  })
});
var Gates = Schema3.Struct({
  ci: Schema3.optionalKey(Schema3.NonEmptyArray(Command).annotate({
    description: "The commands CI runs on every pull request to the default branch, each one plain command"
  })),
  scheduled: Schema3.optionalKey(Schema3.Array(Command).annotate({ description: "The commands a cron-scheduled workflow runs" })),
  lint: Schema3.optionalKey(LintGates)
});
var EffectSources = Schema3.Struct({
  paths: Schema3.NonEmptyArray(PathGlob).annotate({
    description: "Where source is written in Effect, held to the Effect rules of oxlint and the language service"
  }),
  exempt: Schema3.optionalKey(Schema3.Array(PathGlob).annotate({ description: "Files under paths the Effect rules pass over" }))
});
var Sources = Schema3.Struct({
  production: Schema3.optionalKey(Schema3.Array(PathGlob).annotate({ description: "The source the repository ships, as against tests and tooling" })),
  effect: Schema3.optionalKey(EffectSources)
});
var Feature = Schema3.Struct({
  name: Schema3.String.check(Schema3.isPattern(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, { expected: "a feature name in kebab case" })).annotate({ description: "The owner the dependency rule and the change signal name" }),
  root: DirectoryPath.annotate({ description: "The directory the feature owns" }),
  entries: Schema3.NonEmptyArray(FilePath).annotate({
    description: "The files under root that code outside it imports the feature through"
  }),
  allowFrom: Schema3.optionalKey(Schema3.Array(PathGlob).annotate({
    description: "Files outside root that may import past its entries, such as a CLI or a harness; tests/ always may"
  })),
  proof: ProofPath.annotate({ description: "The end-to-end test that imports one of entries" })
}).check(Schema3.makeFilter(({ root, entries }) => {
  const outside = entries.filter((entry) => !entry.startsWith(`${root}/`));
  return outside.length === 0 || `lists ${outside.join(", ")} among its entries, outside its root ${root}`;
}));
function nests(outer, inner) {
  return outer === inner || inner.startsWith(`${outer}/`);
}
var Features = Schema3.Array(Feature).check(Schema3.makeFilter((features) => {
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
var AgentRules = Schema3.Struct({
  on: Schema3.optionalKey(Schema3.Array(RuleName).annotate({ description: "Catalogued Rules switched on here" })),
  off: Schema3.optionalKey(Schema3.Array(RuleName).annotate({ description: "Catalogued Rules switched off here" }))
}).check(Schema3.makeFilter(({ on = [], off = [] }) => {
  const both = on.filter((rule) => off.includes(rule));
  return both.length === 0 || `switches ${both.join(", ")} both on and off`;
}));
var pagesIn = (mode) => Schema3.optionalKey(Schema3.Array(PathGlob).annotate({ description: `The pages written as ${mode}` }));
var Docs = Schema3.Struct({
  pages: Schema3.optionalKey(Schema3.Struct({
    tutorial: pagesIn("a tutorial, which teaches by building one thing"),
    "how-to": pagesIn("a how-to, which walks one task"),
    reference: pagesIn("reference, which describes a thing to be looked up"),
    explanation: pagesIn("an explanation, which says why")
  }).annotate({
    description: "The Diátaxis mode of each page, whose template checks-docs holds the page to; a page under docs/ needs one"
  })),
  forConsumers: Schema3.optionalKey(Schema3.Array(DocGlob).annotate({
    description: "The living docs that speak to a repository installing this one, whose bun run commands checks-docs does not hold to this package.json"
  }))
});
var Quality = Schema3.Struct({
  $schema: Schema3.optionalKey(Schema3.String),
  defaultBranch: Schema3.optionalKey(Schema3.NonEmptyString.annotate({ description: "The branch pull requests merge into; main when absent" })),
  gates: Schema3.optionalKey(Gates),
  commitIdentity: Schema3.optionalKey(CommitIdentity),
  sources: Schema3.optionalKey(Sources),
  size: Schema3.optionalKey(Size),
  features: Schema3.optionalKey(Features.annotate({
    description: "The feature owners dependency-cruiser holds to their entries and checks-feature-owners maps a change to"
  })),
  changeSignal: Schema3.optionalKey(Schema3.Literal("advisory").annotate({
    description: "Report which feature owners a change touches, without failing on it"
  })),
  agentRules: Schema3.optionalKey(AgentRules),
  docs: Schema3.optionalKey(Docs.annotate({ description: "What checks-docs reads to map a doc file to its template" }))
}).annotate({
  title: QUALITY_FILE,
  description: "What a repository has opted into from @avi2dg/checks, read by its bins and agent Rule selection"
}).check(Schema3.makeFilter(({ size, sources }) => size === undefined || (sources?.production ?? []).length > 0 || "declares size, which holds no production file without sources.production", {
  toJsonSchema: () => ({
    if: { required: ["size"] },
    then: { required: ["sources"], properties: { sources: { required: ["production"], properties: { production: { minItems: 1 } } } } }
  })
}), Schema3.makeFilter(({ changeSignal, features = [] }) => changeSignal === undefined || features.length > 0 || "declares changeSignal, which maps a change to no owner without features", {
  toJsonSchema: () => ({
    if: { required: ["changeSignal"] },
    then: { required: ["features"], properties: { features: { minItems: 1 } } }
  })
}));
var LegacyManifest = Schema3.Struct({
  ciWiring: Schema3.optionalKey(Schema3.Struct({
    gates: Schema3.optionalKey(Schema3.NonEmptyArray(Command)),
    scheduled: Schema3.optionalKey(Schema3.Array(Command)),
    lintGates: Schema3.optionalKey(LintGates),
    defaultBranch: Schema3.optionalKey(Schema3.NonEmptyString)
  })),
  commitIdentity: Schema3.optionalKey(CommitIdentity)
});
var LEGACY_KEYS = ["ciWiring", "commitIdentity"];

class QualityUnreadable extends Schema3.TaggedError()("QualityUnreadable", {
  message: Schema3.String
}) {
}
var MANIFEST = "package.json";
var decodeQualityJson = Schema3.decodeUnknownEffect(Schema3.fromJsonString(Quality), { onExcessProperty: "error" });
var decodeManifestJson = Schema3.decodeUnknownEffect(Schema3.fromJsonString(LegacyManifest));
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
var decode = Schema4.decodeUnknownSync(Quality);
function featureRules(quality) {
  return rulesFor(decode(quality, { onExcessProperty: "error" }).features ?? []);
}
export {
  globPattern,
  featureRules
};
