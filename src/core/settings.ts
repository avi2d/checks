import { Effect, FileSystem, Path, Schema } from "effect";
import { Listed } from "./browser-settings.ts";
import { Usage } from "./main.ts";

export const SETTINGS_FILE = "checks.config.ts";

const MANIFEST = "package.json";

export const DEFAULT_AGENT_TESTS = { allowLocal: false } as const;

const AllowAgentRunsOutsideCI = Schema.Boolean.annotate({
  description: "Whether agents may start tests outside CI. This setting does not restrict people or CI.",
  default: DEFAULT_AGENT_TESTS.allowLocal,
});

export const AgentTests = Schema.Struct({ allowLocal: Schema.optionalKey(AllowAgentRunsOutsideCI) }).annotate({
  description: "The settings for test runs started by agents.",
  default: DEFAULT_AGENT_TESTS,
});

export const DEFAULT_TEST_FILE_MAX_SECONDS = 120;

export const TestFileMaxSeconds = Schema.Finite.check(
  Schema.isGreaterThan(0),
  Schema.isLessThanOrEqualTo(DEFAULT_TEST_FILE_MAX_SECONDS),
);

export const TestFileSkips = Schema.Array(Schema.NonEmptyString);

export const TestFileTimings = Schema.Record(Schema.NonEmptyString, Schema.Finite.check(Schema.isGreaterThan(0)));

const ShardCount = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(256));
export const TestTierShards = Schema.Struct({ unit: Schema.optionalKey(ShardCount), e2e: Schema.optionalKey(ShardCount) });
export type TestTierShards = typeof TestTierShards.Type;

export const TrackerKeyPrefixes = Schema.Array(Schema.String.check(Schema.isPattern(/^[A-Z][A-Z0-9]*$/)));

export const Smoke = Schema.Array(Schema.NonEmptyString);

export const Reach = Schema.Record(Schema.String, Schema.Array(Schema.String));

export const BrowserRoutes = Schema.Record(Schema.NonEmptyString, Schema.Array(Schema.NonEmptyString));

export const BrowserBuild = Schema.NonEmptyArray(Schema.NonEmptyString);

export const BrowserTimings = Schema.Record(Schema.NonEmptyString, Schema.Record(Schema.NonEmptyString, Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0))));

export type BrowserTimings = typeof BrowserTimings.Type;

export const MutationRunner = Schema.NonEmptyArray(Schema.NonEmptyString);

export const SelfHostedRunners = Schema.Array(Schema.NonEmptyArray(Schema.NonEmptyString));

export const Inputs = Schema.Struct({ inputs: Schema.NonEmptyArray(Schema.NonEmptyString) });

export const NestedOxlintConfigs = Schema.Record(Schema.NonEmptyString, Schema.NonEmptyArray(Schema.NonEmptyString));

export const RepositoryVisibility = Schema.Literals(["public", "private"]);

export const ReleaseAssets = Schema.Boolean;

const PLATFORM_NAMES = ["darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64"] as const;

export type PlatformName = (typeof PLATFORM_NAMES)[number];

export const PlatformPackages = Schema.Struct({
  binary: Schema.String.check(Schema.isPattern(/^[a-z0-9][a-z0-9._-]*$/, { message: "is not a lowercase file name, such as acme" })).annotate({
    description: "The name release:assets gives each compiled file, which it writes as <binary>-<os>-<cpu>.",
  }),
  platforms: Schema.NonEmptyArray(Schema.Literals(PLATFORM_NAMES))
    .check(Schema.makeFilter((platforms) => new Set(platforms).size === platforms.length || "names a platform twice"))
    .annotate({ description: "The platforms to build on and publish a package for." }),
});

export type PlatformPackages = typeof PlatformPackages.Type;

const Command = Schema.String.check(Schema.isPattern(/^[^\r\n]*\S[^\r\n]*$/, { message: "is not one line holding a command" }));

export const ExtraTestJob = Schema.Struct({
  name: Schema.String.check(Schema.isPattern(/^[A-Za-z_][A-Za-z0-9_-]*$/, { message: "is not a job id, such as sandbox" })).annotate({
    description: "The id of the job in ci.yml, which the checks job requires.",
  }),
  env: Schema.optionalKey(
    Schema.Record(
      Schema.String.check(Schema.isPattern(/^[A-Za-z_][A-Za-z0-9_]*$/, { message: "is not an environment variable name, such as SANDBOX_TESTS" })),
      Schema.String.check(Schema.isPattern(/^[^\r\n]*$/, { message: "is not one line" })),
    ).annotate({ description: "The environment variables the job sets for its setup and test commands." }),
  ),
  setup: Schema.optionalKey(Schema.Array(Command).annotate({ description: "The commands the job runs, one step each, before the test command, such as one that installs a tool." })),
  run: Command.annotate({ description: "The test command." }),
});

export type ExtraTestJob = typeof ExtraTestJob.Type;

const EXTRA_TEST_JOBS_ANNOTATIONS = {
  description: "The test jobs the generated ci.yml runs beside its default ones, each with its own environment, setup commands and test command.",
  default: [],
};

export const ExtraTestJobs = Schema.Array(ExtraTestJob).annotate(EXTRA_TEST_JOBS_ANNOTATIONS).check(
  Schema.makeFilter((jobs) => new Set(jobs.map(({ name }) => name)).size === jobs.length || "names a job twice", EXTRA_TEST_JOBS_ANNOTATIONS),
);

export const LegacySettings = Schema.Struct({
  repositoryVisibility: Schema.optionalKey(RepositoryVisibility.annotate({ description: "The GitHub repository visibility that selects generated workflow runners.", default: "public" })),
  releaseAssets: Schema.optionalKey(ReleaseAssets.annotate({
    description: "Whether the generated main.yml, or the kit's release.yml, builds the files bun run release:assets writes on Linux and macOS and attaches them to each GitHub release.",
    default: false,
  })),
  platformPackages: Schema.optionalKey(PlatformPackages.annotate({
    description: "The compiled binary the generated main.yml builds on each named platform and publishes as one npm package per platform before the main package, which lists them as optionalDependencies.",
  })),
  extraTestJobs: Schema.optionalKey(ExtraTestJobs),
  trackerKeyPrefixes: Schema.optionalKey(TrackerKeyPrefixes.annotate({
    description: "The uppercase tracker prefixes whose numbered keys the comment gate refuses.",
    default: [],
  })),
  smoke: Schema.optionalKey(Smoke.annotate({ description: "The extra test files to run with the local unit tier." })),
  reach: Schema.optionalKey(Reach.annotate({ description: "The tests to run when a changed path is missing from the import graph." })),
  mutationRunner: Schema.optionalKey(MutationRunner.annotate({ description: "The runner labels for mutation jobs in a private repository." })),
  selfHostedRunners: Schema.optionalKey(SelfHostedRunners.annotate({ description: "The other sets of self-hosted runner labels that jobs in a private repository may use." })),
  browser: Schema.optionalKey(Listed.annotate({ description: "The site, routes, and checks for browser tests." })),
  browserRoutes: Schema.optionalKey(BrowserRoutes.annotate({ description: "The repository paths that can affect each browser route." })),
  browserBuild: Schema.optionalKey(BrowserBuild.annotate({ description: "The command that builds the site for the browser test-only proof." })),
  browserTimings: Schema.optionalKey(BrowserTimings.annotate({ description: "The measured milliseconds of each browser check at each route, which browser shards balance on." })),
  copy: Schema.optionalKey(Inputs.annotate({ description: "The input globs for the copy gate." })),
  frontendSyntax: Schema.optionalKey(Inputs.annotate({ description: "The input globs for the frontend syntax gate." })),
  nestedOxlintConfigs: Schema.optionalKey(NestedOxlintConfigs.annotate({
    description: "The rules each nested oxlint config, named by its repository-relative path, may turn off, down to a lower severity, or to other options than the root oxlint config sets.",
  })),
  agentTests: Schema.optionalKey(AgentTests),
  testFileMaxSeconds: Schema.optionalKey(TestFileMaxSeconds.annotate({
    description: "The time limit in seconds for each test file in CI.",
    default: DEFAULT_TEST_FILE_MAX_SECONDS,
  })),
  testTierShards: Schema.optionalKey(TestTierShards.annotate({ description: "The number of parallel CI jobs for each test tier." })),
  testFileTimings: Schema.optionalKey(TestFileTimings.annotate({ description: "The recorded seconds per test file, which balance the shards." })),
  testFileSkips: Schema.optionalKey(TestFileSkips.annotate({
    description: "The repository-relative paths of test files to exclude from checks-test.",
    default: [],
  })),
});

const legacy = LegacySettings.fields;

const GroupedSettings = {
  workflows: Schema.Struct({
    repositoryVisibility: legacy.repositoryVisibility,
    releaseAssets: legacy.releaseAssets,
    platformPackages: legacy.platformPackages,
    extraTestJobs: legacy.extraTestJobs,
    mutationRunsOn: legacy.mutationRunner,
    selfHostedRunsOn: legacy.selfHostedRunners,
    testShards: legacy.testTierShards,
  }),
  test: Schema.Struct({
    extraLocalFiles: legacy.smoke,
    affected: legacy.reach,
    allowAgentRunsOutsideCI: Schema.optionalKey(AllowAgentRunsOutsideCI),
    fileTimeoutSeconds: legacy.testFileMaxSeconds,
    fileTimingsSeconds: legacy.testFileTimings,
    excludeFiles: legacy.testFileSkips,
  }),
  commentGate: Schema.Struct({ trackerKeyPrefixes: legacy.trackerKeyPrefixes }),
  lintCoverage: Schema.Struct({ allowedNestedOxlintRules: legacy.nestedOxlintConfigs }),
};

export const Settings = Schema.Struct({
  workflows: Schema.optionalKey(GroupedSettings.workflows),
  test: Schema.optionalKey(GroupedSettings.test),
  copy: legacy.copy,
  frontendSyntax: legacy.frontendSyntax,
  commentGate: Schema.optionalKey(GroupedSettings.commentGate),
  lintCoverage: Schema.optionalKey(GroupedSettings.lintCoverage),
  browser: legacy.browser,
  browserRoutes: legacy.browserRoutes,
  browserBuild: legacy.browserBuild,
  browserTimings: legacy.browserTimings,
});

export type SettingKey = keyof typeof legacy;

const SETTING_KEYS = [...Object.keys(Settings.fields), ...Object.keys(legacy).filter((key) => !Object.hasOwn(Settings.fields, key))];

export type OldPlace = { readonly file: string } | { readonly manifestKey: string };

const UnknownFields = Schema.Record(Schema.String, Schema.Unknown);

const SettingsModule = Schema.Struct({ default: UnknownFields });

const decodeSettingsModule = Schema.decodeUnknownEffect(SettingsModule);

const OldManifest = Schema.fromJsonString(Schema.Struct({ checks: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)) }));

const decodeOldManifest = Schema.decodeUnknownEffect(OldManifest);

const TRANSITION_KEYS = {
  workflows: {
    repositoryVisibility: "repositoryVisibility",
    releaseAssets: "releaseAssets",
    platformPackages: "platformPackages",
    extraTestJobs: "extraTestJobs",
    mutationRunsOn: "mutationRunner",
    selfHostedRunsOn: "selfHostedRunners",
    testShards: "testTierShards",
  },
  test: {
    extraLocalFiles: "smoke",
    affected: "reach",
    allowAgentRunsOutsideCI: "agentTests",
    fileTimeoutSeconds: "testFileMaxSeconds",
    fileTimingsSeconds: "testFileTimings",
    excludeFiles: "testFileSkips",
  },
  commentGate: { trackerKeyPrefixes: "trackerKeyPrefixes" },
  lintCoverage: { allowedNestedOxlintRules: "nestedOxlintConfigs" },
} satisfies { [Section in keyof typeof GroupedSettings]: Record<keyof (typeof GroupedSettings)[Section]["fields"], SettingKey> };

const refuseUnknownSettings = Effect.fn("refuseUnknownSettings")(function* (
  location: string, raw: Readonly<Record<string, unknown>>, known: readonly string[],
) {
  const unknown = Object.keys(raw).filter((key) => !known.includes(key));
  if (unknown.length > 0) {
    return yield* new Usage({ message: `${location} sets ${unknown.join(", ")}, which no command reads; its keys are ${known.join(", ")}` });
  }
});

const normalizeSection = Effect.fn("normalizeSection")(function* (
  settings: Record<string, unknown>, section: string, keys: Readonly<Record<string, SettingKey>>,
) {
  if (!Object.hasOwn(settings, section)) return;
  const location = `${SETTINGS_FILE} key ${section}`;
  const values = yield* Schema.decodeUnknownEffect(UnknownFields)(settings[section]).pipe(
    Effect.mapError(({ message }) => new Usage({ message: `${location} does not decode: ${message}` })),
  );
  yield* refuseUnknownSettings(location, values, Object.keys(keys));
  delete settings[section];
  for (const [key, legacyKey] of Object.entries(keys)) {
    if (!Object.hasOwn(values, key)) continue;
    const agentPolicy = legacyKey === "agentTests";
    const old = settings[legacyKey];
    const repeated = agentPolicy
      ? old !== undefined && Object.hasOwn(yield* decodeSetting(legacyKey, AgentTests, old), "allowLocal")
      : Object.hasOwn(settings, legacyKey);
    if (repeated) {
      const oldPath = agentPolicy ? "agentTests.allowLocal" : legacyKey;
      const newPath = `${section}.${key}`;
      return yield* new Usage({ message: `${SETTINGS_FILE} key ${oldPath} and ${SETTINGS_FILE} key ${newPath} set the same setting; keep only ${newPath}` });
    }
    settings[legacyKey] = agentPolicy ? { allowLocal: values[key] } : values[key];
  }
});

export const loadSettings = Effect.fn("loadSettings")(function* (root: string) {
  const fs = yield* FileSystem.FileSystem;
  const file = (yield* Path.Path).join(root, SETTINGS_FILE);
  if (!(yield* fs.exists(file))) return {};
  const loaded: unknown = yield* Effect.tryPromise({
    try: () => import(file),
    catch: (cause) => new Usage({ message: `${SETTINGS_FILE} does not load: ${String(cause)}` }),
  });
  const { default: settings } = yield* decodeSettingsModule(loaded).pipe(
    Effect.mapError(() => new Usage({ message: `${SETTINGS_FILE} has no default export of a settings object; export defineConfig({ ... }) from @avi2dg/checks/config` })),
  );
  if (Object.hasOwn(settings, "localTests")) {
    return yield* new Usage({ message: `${SETTINGS_FILE} key localTests is no longer read; use agentTests.allowLocal instead` });
  }
  yield* refuseUnknownSettings(SETTINGS_FILE, settings, SETTING_KEYS);
  const normalized = { ...settings };
  for (const [section, keys] of Object.entries(TRANSITION_KEYS)) yield* normalizeSection(normalized, section, keys);
  return normalized;
});

function oldPlaceName(old: OldPlace): string {
  return "file" in old ? old.file : `${MANIFEST} checks.${old.manifestKey}`;
}

const holdsOldPlace = Effect.fn("holdsOldPlace")(function* (root: string, old: OldPlace) {
  const fs = yield* FileSystem.FileSystem;
  const file = (yield* Path.Path).join(root, "file" in old ? old.file : MANIFEST);
  if (!(yield* fs.exists(file))) return false;
  if ("file" in old) return true;
  const { checks } = yield* fs.readFileString(file).pipe(
    Effect.flatMap(decodeOldManifest),
    Effect.mapError((cause) => new Usage({ message: `cannot read ${MANIFEST}: ${cause.message}` })),
  );
  return checks !== undefined && Object.hasOwn(checks, old.manifestKey);
});

export const refuseOldPlace = Effect.fn("refuseOldPlace")(function* (root: string, key: SettingKey, old: OldPlace) {
  if (!(yield* holdsOldPlace(root, old))) return;
  return yield* new Usage({ message: `${oldPlaceName(old)} is no longer read; move it to the ${key} key of ${SETTINGS_FILE}` });
});

export const decodeSetting = Effect.fn("decodeSetting")(function* <A>(key: SettingKey, schema: Schema.Decoder<A>, value: unknown) {
  return yield* Schema.decodeUnknownEffect(schema)(value, { onExcessProperty: "error" }).pipe(
    Effect.mapError(({ message }) => new Usage({ message: `${SETTINGS_FILE} key ${key} does not decode: ${message}` })),
  );
});

export const readSetting = Effect.fn("readSetting")(function* <A>(root: string, key: SettingKey, schema: Schema.Decoder<A>, old: OldPlace) {
  yield* refuseOldPlace(root, key, old);
  const value = (yield* loadSettings(root))[key];
  if (value === undefined) return undefined;
  return yield* decodeSetting(key, schema, value);
});
