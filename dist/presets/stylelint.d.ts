import type { Config } from "stylelint";
type Globs = readonly [string, ...string[]];
export type BaselineTarget = "widely" | "newly" | number;
export type ChecksStylelintConfig = Omit<Config, "extends" | "plugins"> & {
    readonly baseline: BaselineTarget;
    readonly tokens: Globs | false;
    readonly bem?: boolean;
    readonly flatSelectors?: boolean;
    readonly noPageHas?: boolean;
};
export declare const MARKUP: readonly ["**/*.html", "**/*.astro", "**/*.vue", "**/*.svelte"];
export declare function defineConfig({ baseline, tokens, bem, flatSelectors, noPageHas, rules, overrides, ...rest }: ChecksStylelintConfig): Config;
export {};
