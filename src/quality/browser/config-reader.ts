import { Effect, Path, Schema } from "effect";
import { BROWSER_SETTINGS_FILE, BrowserSettings, LEGACY_BROWSER_OPTIONS, Listed } from "../../core/browser-settings.ts";
import { Usage } from "../../core/main.ts";
import { decodeSettingAt, loadSettings, readSettingsModule, refuseOldPlace, refuseUnknownSettings, SETTINGS_FILE } from "../../core/settings.ts";

const PLAN_KEYS = Object.keys(Listed.fields);
const CONFIG_KEYS = Object.keys(BrowserSettings.fields);
const EXAMPLE = "defineBrowserConfig({ ... }) from @avi2dg/checks/browser-config";

function duplicate(oldKey: string, destination: string): Usage {
  return new Usage({ message: `${SETTINGS_FILE} key ${oldKey} and ${destination} set the same setting; keep only ${destination}` });
}

function setsBrowserPlan(config: Readonly<Record<string, unknown>>): boolean {
  return PLAN_KEYS.some((key) => Object.hasOwn(config, key));
}

const loadBrowserConfig = Effect.fn("loadBrowserConfig")(function* (root: string) {
  const { values: legacy } = yield* loadSettings(root);
  const file = (yield* Path.Path).resolve(root, BROWSER_SETTINGS_FILE);
  const config = yield* readSettingsModule(file, BROWSER_SETTINGS_FILE, EXAMPLE);
  if (config === undefined) return { legacy, config };
  yield* refuseUnknownSettings(BROWSER_SETTINGS_FILE, config, CONFIG_KEYS);
  if (Object.hasOwn(legacy, "browser") && setsBrowserPlan(config)) {
    return yield* duplicate("browser", BROWSER_SETTINGS_FILE);
  }
  for (const [key, oldKey] of Object.entries(LEGACY_BROWSER_OPTIONS)) {
    if (Object.hasOwn(legacy, oldKey) && Object.hasOwn(config, key)) {
      return yield* duplicate(oldKey, `${BROWSER_SETTINGS_FILE} key ${key}`);
    }
  }
  return { legacy, config };
});

export const readBrowserPlan = Effect.fn("readBrowserPlan")(function* (root: string) {
  yield* refuseOldPlace(root, "browser", { file: "browser-checks.json" });
  const { legacy, config } = yield* loadBrowserConfig(root);
  if (config !== undefined && (legacy["browser"] === undefined || setsBrowserPlan(config))) {
    const fields = Object.fromEntries(PLAN_KEYS.filter((key) => Object.hasOwn(config, key)).map((key) => [key, config[key]]));
    return { listed: yield* decodeSettingAt(BROWSER_SETTINGS_FILE, Listed, fields), location: BROWSER_SETTINGS_FILE };
  }
  const location = `${SETTINGS_FILE} key browser`;
  return legacy["browser"] === undefined ? undefined : { listed: yield* decodeSettingAt(location, Listed, legacy["browser"]), location };
});

const readOption = Effect.fn("readOption")(function* <A>(
  root: string, key: keyof typeof LEGACY_BROWSER_OPTIONS, schema: Schema.Decoder<A>,
) {
  const { legacy, config } = yield* loadBrowserConfig(root);
  if (config !== undefined && Object.hasOwn(config, key)) {
    const location = `${BROWSER_SETTINGS_FILE} key ${key}`;
    return { value: yield* decodeSettingAt(location, schema, config[key]), location };
  }
  const oldKey = LEGACY_BROWSER_OPTIONS[key];
  if (legacy[oldKey] === undefined) return undefined;
  const location = `${SETTINGS_FILE} key ${oldKey}`;
  return { value: yield* decodeSettingAt(location, schema, legacy[oldKey]), location };
});

export const readAffectedRoutes = Effect.fn("readAffectedRoutes")(function* (root: string) {
  return yield* readOption(root, "affectedRoutes", BrowserSettings.fields.affectedRoutes);
});

export const readBuildCommand = Effect.fn("readBuildCommand")(function* (root: string) {
  return (yield* readOption(root, "buildCommand", BrowserSettings.fields.buildCommand))?.value;
});

export const readTimings = Effect.fn("readTimings")(function* (root: string) {
  return (yield* readOption(root, "timingsMs", BrowserSettings.fields.timingsMs))?.value;
});
