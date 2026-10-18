import type { Config } from "stylelint";
type Globs = readonly [string, ...string[]];
export type BaselineTarget = "widely" | "newly" | number;
export type ChecksStylelintConfig = Omit<Config, "extends" | "plugins"> & {
    readonly baseline: BaselineTarget;
    readonly tokens: Globs | false;
};
export declare const MARKUP: readonly ["**/*.html", "**/*.astro", "**/*.vue", "**/*.svelte"];
export declare function defineConfig({ baseline, tokens, rules, overrides, ...rest }: ChecksStylelintConfig): Config;
export {};
