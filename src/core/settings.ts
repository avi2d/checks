import { Effect, FileSystem, Path, Schema } from "effect";
import { Usage } from "./main.ts";

export const SETTINGS_FILE = "checks.config.ts";

const MANIFEST = "package.json";

const SETTING_KEYS = ["smoke", "reach", "mutationRunner", "selfHostedRunners", "browser", "browserRoutes", "browserBuild", "copy", "frontendSyntax", "localTests", "testFileMaxSeconds"] as const;

export type SettingKey = (typeof SETTING_KEYS)[number];

export const LocalTests = Schema.Literals(["blocked", "allowed"]);

export const TestFileMaxSeconds = Schema.Finite.check(Schema.isGreaterThan(0));

export const Smoke = Schema.Array(Schema.NonEmptyString);

export const Reach = Schema.Record(Schema.String, Schema.Array(Schema.String));

export const BrowserRoutes = Schema.Record(Schema.NonEmptyString, Schema.Array(Schema.NonEmptyString));

export const BrowserBuild = Schema.NonEmptyArray(Schema.NonEmptyString);

export const MutationRunner = Schema.NonEmptyArray(Schema.NonEmptyString);

export const SelfHostedRunners = Schema.Array(Schema.NonEmptyArray(Schema.NonEmptyString));

export const Inputs = Schema.Struct({ inputs: Schema.NonEmptyArray(Schema.NonEmptyString) });

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
