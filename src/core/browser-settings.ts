import { Schema } from "effect";

import { DEVICES, SCREEN_SIZE_SETS } from "./browser-options.ts";

const CHECKS = ["layout", "keyboard", "motion", "axe", "nesting", "html", "links", "assets", "contrast", "weight", "shift", "look"] as const;

export type CheckName = (typeof CHECKS)[number];

const Name = Schema.NonEmptyString;
const Pixels = Schema.Int.check(Schema.isGreaterThan(0));
const Bytes = Schema.Int.check(Schema.isGreaterThan(0));

const Route = Schema.Struct({
  path: Schema.String.check(Schema.isPattern(/^\//, { message: "is not a path from the site root, such as /ru/" })),
  locale: Name,
});

const ROUTE_PRESETS = ["every-page"] as const;

const RoutePreset = Schema.Struct({ preset: Schema.Literals(ROUTE_PRESETS), locale: Name });

const Viewport = Schema.Struct({
  name: Name,
  width: Pixels,
  height: Pixels,
  touch: Schema.optionalKey(Schema.Boolean),
  device: Schema.optionalKey(Schema.Literals(DEVICES)),
});

const ScreenSizeSet = Schema.Struct({ preset: Schema.Literals(SCREEN_SIZE_SETS) });

const State = Schema.Struct({
  name: Name,
  textPx: Schema.optionalKey(Pixels),
  reducedMotion: Schema.optionalKey(Schema.Literals(["reduce", "no-preference"])),
  checks: Schema.optionalKey(Schema.NonEmptyArray(Schema.Literals(CHECKS))),
});

export const STATE_PRESETS = ["enlarged-text"] as const;

const StatePreset = Schema.Struct({ preset: Schema.Literals(STATE_PRESETS) });

const Target = Schema.Struct({
  name: Name,
  selector: Name,
  routes: Schema.optionalKey(Schema.NonEmptyArray(Name)),
  focusable: Schema.optionalKey(Schema.Boolean),
  contrast: Schema.optionalKey(Schema.Boolean),
});

const WeightBudgets = Schema.Struct({
  nonImageBytes: Bytes,
  scriptBytes: Bytes,
  imageBytes: Bytes,
});

const ShiftBound = Schema.Struct({
  max: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)),
});

const Roles = Schema.Record(Name, Schema.NonEmptyArray(Name));

const Declaration = Schema.Struct({
  site: Name.annotate({ description: "The directory of the built site, served on a local port." }),
  routes: Schema.NonEmptyArray(Route),
  viewports: Schema.NonEmptyArray(Viewport),
  states: Schema.NonEmptyArray(State),
  targets: Schema.NonEmptyArray(Target).annotate({
    description: "The named controls or texts to check, with CSS selectors and optional routes, focus, and contrast settings.",
  }),
  checks: Schema.NonEmptyArray(Schema.Literals(CHECKS)).annotate({ description: "The built-in checks to run." }),
  weight: Schema.optionalKey(WeightBudgets.annotate({ description: "The byte budgets for each page: outside images, in scripts, and in images." })),
  shift: Schema.optionalKey(ShiftBound.annotate({ description: "The largest total layout shift allowed on a cold load." })),
  roles: Schema.optionalKey(Roles.annotate({ description: "The named text roles and their CSS selectors for the look check." })),
  hooks: Schema.optionalKey(Name.annotate({ description: "The module of product hooks, relative to the directory the runner runs in." })),
});

export const Listed = Schema.Struct({
  ...Declaration.fields,
  routes: Schema.NonEmptyArray(Schema.Union([Route, RoutePreset])).annotate({ description: "The pages to visit, with a path and locale or the every-page preset and a locale." }),
  viewports: Schema.NonEmptyArray(Schema.Union([Viewport, ScreenSizeSet])).annotate({
    description: "The window sizes to visit, with a name, width, and height in pixels, optional touch and device settings, or a screen-size preset.",
  }),
  states: Schema.NonEmptyArray(Schema.Union([State, StatePreset])).annotate({
    description: "The conditions to visit, with a name and optional text size, motion preference, and checks, or the enlarged-text preset.",
  }),
});

export type Route = typeof Route.Type;
export type Viewport = typeof Viewport.Type;
export type State = typeof State.Type;
export type Target = typeof Target.Type;
export type WeightBudgets = typeof WeightBudgets.Type;
export type ShiftBound = typeof ShiftBound.Type;
export type Roles = typeof Roles.Type;
export type Declaration = typeof Declaration.Type;

export type Listed = typeof Listed.Type;

const BrowserRoutes = Schema.Record(Schema.NonEmptyString, Schema.Array(Schema.NonEmptyString)).annotate({
  description: "The repository paths that can affect each browser route.",
});

const BrowserBuild = Schema.NonEmptyArray(Schema.NonEmptyString).annotate({
  description: "The command that builds the site for the browser test-only proof.",
});

const BrowserTimings = Schema.Record(
  Schema.NonEmptyString,
  Schema.Record(Schema.NonEmptyString, Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0))),
).annotate({
  description: "The measured milliseconds of each browser check at each route, which browser shards balance on.",
});

export type BrowserTimings = typeof BrowserTimings.Type;

export const BrowserSettings = Schema.Struct({
  ...Listed.fields,
  affectedRoutes: Schema.optionalKey(BrowserRoutes),
  buildCommand: Schema.optionalKey(BrowserBuild),
  timingsMs: Schema.optionalKey(BrowserTimings),
});

export type AffectedRoutes = typeof BrowserRoutes.Type;

export const BROWSER_SETTINGS_FILE = "checks.browser.config.ts";

export const LEGACY_BROWSER_OPTIONS = {
  affectedRoutes: "browserRoutes",
  buildCommand: "browserBuild",
  timingsMs: "browserTimings",
} as const;

export const LegacyBrowserFields = {
  browser: Schema.optionalKey(Listed),
  [LEGACY_BROWSER_OPTIONS.affectedRoutes]: BrowserSettings.fields.affectedRoutes,
  [LEGACY_BROWSER_OPTIONS.buildCommand]: BrowserSettings.fields.buildCommand,
  [LEGACY_BROWSER_OPTIONS.timingsMs]: BrowserSettings.fields.timingsMs,
};

export function browserSettingDestination(key: keyof typeof LegacyBrowserFields): string {
  for (const [member, legacy] of Object.entries(LEGACY_BROWSER_OPTIONS)) {
    if (legacy === key) return `${BROWSER_SETTINGS_FILE} key ${member}`;
  }
  return BROWSER_SETTINGS_FILE;
}
