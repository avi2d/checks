import type { Settings } from "../core/settings.ts";

export type ChecksConfig = typeof Settings.Encoded;

export function defineConfig(config: ChecksConfig): ChecksConfig {
  return config;
}
