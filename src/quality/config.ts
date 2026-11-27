import type { LegacySettings, Settings } from "../core/settings.ts";

export type ChecksConfig = typeof Settings.Encoded & typeof LegacySettings.Encoded;

export function defineConfig(config: ChecksConfig): ChecksConfig {
  return config;
}
