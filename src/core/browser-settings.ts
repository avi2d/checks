import { Schema } from "effect";

import { DEVICES, SCREEN_SIZE_SETS } from "./browser-options.ts";

const CHECKS = ["layout", "keyboard", "motion", "axe", "nesting", "html", "links", "assets", "contrast", "weight", "shift", "look"] as const;

export type CheckName = (typeof CHECKS)[number];

function listed(values: readonly string[], conjunction: "and" | "or"): string {
  return values.length < 2 ? values.join("") : `${values.slice(0, -1).join(", ")} ${conjunction} ${values.at(-1)}`;
}

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

const MOTION_PREFERENCES = ["reduce", "no-preference"] as const;

const State = Schema.Struct({
  name: Name,
  textPx: Schema.optionalKey(Pixels),
  reducedMotion: Schema.optionalKey(Schema.Literals(MOTION_PREFERENCES)),
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
  site: Name.annotate({ description: "The directory of the built site, which the runner serves on a local port, with an index.html answering for its directory." }),
  routes: Schema.NonEmptyArray(Route),
  viewports: Schema.NonEmptyArray(Viewport),
  states: Schema.NonEmptyArray(State),
  targets: Schema.NonEmptyArray(Target).annotate({
    description: "Each named control or text the checks judge, with a CSS selector, the routes it is on when not every route, focusable when Tab must reach it, and contrast when the contrast check measures its text.",
  }),
  checks: Schema.NonEmptyArray(Schema.Literals(CHECKS)).annotate({ description: `The built-in checks to run, from ${listed(CHECKS, "and")}.` }),
  weight: Schema.optionalKey(WeightBudgets.annotate({
    description: "The byte budgets each page must hold, as nonImageBytes outside images, scriptBytes in scripts and imageBytes in images.",
  })),
  shift: Schema.optionalKey(ShiftBound.annotate({ description: "The largest total layout movement a cold load may report, as max." })),
  roles: Schema.optionalKey(Roles.annotate({
    description: "Each role a text plays on the page, named, with the CSS selectors of the elements that play it, for the look check.",
  })),
  hooks: Schema.optionalKey(Name.annotate({ description: "The module of product hooks, as a path from the directory the runner runs in." })),
});

export const Listed = Schema.Struct({
  ...Declaration.fields,
  routes: Schema.NonEmptyArray(Schema.Union([Route, RoutePreset])).annotate({
    description: `Each page to visit, as a path from the site root and the locale it renders, or the ${listed(ROUTE_PRESETS, "or")} preset with a locale.`,
  }),
  viewports: Schema.NonEmptyArray(Schema.Union([Viewport, ScreenSizeSet])).annotate({
    description: `Each window to visit in, with a name, a width and a height in pixels, touch for a phone that has touch and a mobile viewport, and device as ${listed(DEVICES, "or")}, or the ${listed(SCREEN_SIZE_SETS, "or")} preset, which stands for a set of screen sizes.`,
  }),
  states: Schema.NonEmptyArray(Schema.Union([State, StatePreset])).annotate({
    description: `Each condition to visit in, with a name, textPx for the browser's default text size, reducedMotion as ${listed(MOTION_PREFERENCES, "or")}, and checks when it runs only some of the declared checks, or the ${listed(STATE_PRESETS, "or")} preset.`,
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
