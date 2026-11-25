import { Effect, FileSystem, Path, Schema } from "effect";
import { Listed } from "./browser-settings.ts";
import { Usage } from "./main.ts";

export const SETTINGS_FILE = "checks.config.ts";

const MANIFEST = "package.json";

export const DEFAULT_AGENT_TESTS = { allowLocal: false } as const;

export const AgentTests = Schema.Struct({
  allowLocal: Schema.optionalKey(Schema.Boolean.annotate({
    description: "Whether agents may start tests outside CI. This setting does not restrict people or CI.",
    default: DEFAULT_AGENT_TESTS.allowLocal,
  })),
}).annotate({
  description: "The settings for test runs started by agents.",
  default: DEFAULT_AGENT_TESTS,
});

export const DEFAULT_TEST_FILE_MAX_SECONDS = 120;

export const TestFileMaxSeconds = Schema.Finite.check(
  Schema.isGreaterThan(0),
  Schema.isLessThanOrEqualTo(DEFAULT_TEST_FILE_MAX_SECONDS),
);

export const TestFileSkips = Schema.Array(Schema.NonEmptyString);

export const Smoke = Schema.Array(Schema.NonEmptyString);

export const Reach = Schema.Record(Schema.String, Schema.Array(Schema.String));

export const BrowserRoutes = Schema.Record(Schema.NonEmptyString, Schema.Array(Schema.NonEmptyString));

export const BrowserBuild = Schema.NonEmptyArray(Schema.NonEmptyString);

export const BrowserTimings = Schema.Record(Schema.NonEmptyString, Schema.Record(Schema.NonEmptyString, Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0))));

export type BrowserTimings = typeof BrowserTimings.Type;

export const MutationRunner = Schema.NonEmptyArray(Schema.NonEmptyString);

export const SelfHostedRunners = Schema.Array(Schema.NonEmptyArray(Schema.NonEmptyString));

export const Inputs = Schema.Struct({ inputs: Schema.NonEmptyArray(Schema.NonEmptyString) });

export const RepositoryVisibility = Schema.Literals(["public", "private"]);

export const ReleaseAssets = Schema.Boolean;

export const Settings = Schema.Struct({
  repositoryVisibility: Schema.optionalKey(RepositoryVisibility.annotate({ description: "The GitHub repository visibility that selects generated workflow runners.", default: "public" })),
  releaseAssets: Schema.optionalKey(ReleaseAssets.annotate({
    description: "Whether the generated main.yml, or the kit's release.yml, builds the files bun run release:assets writes on Linux and macOS and attaches them to each GitHub release.",
    default: false,
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
  agentTests: Schema.optionalKey(AgentTests),
  testFileMaxSeconds: Schema.optionalKey(TestFileMaxSeconds.annotate({
    description: "The time limit in seconds for each test file in CI.",
    default: DEFAULT_TEST_FILE_MAX_SECONDS,
  })),
  testFileSkips: Schema.optionalKey(TestFileSkips.annotate({
    description: "The repository-relative paths of test files to exclude from checks-test.",
    default: [],
  })),
});

export type SettingKey = keyof typeof Settings.fields;

const SETTING_KEYS = Object.keys(Settings.fields);

export type OldPlace = { readonly file: string } | { readonly manifestKey: string };

const SettingsModule = Schema.Struct({ default: Schema.Record(Schema.String, Schema.Unknown) });

const decodeSettingsModule = Schema.decodeUnknownEffect(SettingsModule);

const OldManifest = Schema.fromJsonString(Schema.Struct({ checks: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)) }));

const decodeOldManifest = Schema.decodeUnknownEffect(OldManifest);

function isSettingKey(key: string): key is SettingKey {
  return SETTING_KEYS.some((known) => known === key);
}

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
  const unknown = Object.keys(settings).filter((key) => !isSettingKey(key));
  if (unknown.length > 0) {
    return yield* new Usage({ message: `${SETTINGS_FILE} sets ${unknown.join(", ")}, which no command reads; its keys are ${SETTING_KEYS.join(", ")}` });
  }
  return settings;
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
