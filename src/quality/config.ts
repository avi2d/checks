import { Schema } from "effect";
import { BrowserBuild, BrowserRoutes, Inputs, MutationRunner, Reach, SelfHostedRunners, Smoke, type SettingKey } from "../core/settings.ts";
import { Listed } from "./browser/declaration.ts";

const Settings = Schema.Struct({
  smoke: Schema.optionalKey(Smoke),
  reach: Schema.optionalKey(Reach),
  mutationRunner: Schema.optionalKey(MutationRunner),
  selfHostedRunners: Schema.optionalKey(SelfHostedRunners),
  browser: Schema.optionalKey(Listed),
  browserRoutes: Schema.optionalKey(BrowserRoutes),
  browserBuild: Schema.optionalKey(BrowserBuild),
  copy: Schema.optionalKey(Inputs),
  frontendSyntax: Schema.optionalKey(Inputs),
} satisfies Record<SettingKey, Schema.Top>);

export type ChecksConfig = typeof Settings.Encoded;

export function defineConfig(config: ChecksConfig): ChecksConfig {
  return config;
}
