import type { BrowserSettings } from "../core/browser-settings.ts";

export type BrowserConfig = typeof BrowserSettings.Encoded;

export function defineBrowserConfig(config: BrowserConfig): BrowserConfig {
  return config;
}
