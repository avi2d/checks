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
  site: Name,
  routes: Schema.NonEmptyArray(Route),
  viewports: Schema.NonEmptyArray(Viewport),
  states: Schema.NonEmptyArray(State),
  targets: Schema.NonEmptyArray(Target),
  checks: Schema.NonEmptyArray(Schema.Literals(CHECKS)),
  weight: Schema.optionalKey(WeightBudgets),
  shift: Schema.optionalKey(ShiftBound),
  roles: Schema.optionalKey(Roles),
  hooks: Schema.optionalKey(Name),
});

export const Listed = Schema.Struct({
  ...Declaration.fields,
  routes: Schema.NonEmptyArray(Schema.Union([Route, RoutePreset])),
  viewports: Schema.NonEmptyArray(Schema.Union([Viewport, ScreenSizeSet])),
  states: Schema.NonEmptyArray(Schema.Union([State, StatePreset])),
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
