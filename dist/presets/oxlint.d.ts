import type { OxlintConfig, OxlintOverride } from "oxlint";
type Globs = readonly [string, ...string[]];
export type EffectScope = boolean | {
    readonly files?: Globs;
    readonly excludeFiles?: readonly string[];
};
export type ChecksConfig = Omit<OxlintConfig, "extends" | "plugins" | "jsPlugins" | "categories"> & {
    readonly effect: EffectScope;
};
declare const SIZE_RULES: readonly ["max-lines", "max-lines-per-function", "max-statements", "readability/cognitive-complexity", "max-depth"];
export type SizeRule = (typeof SIZE_RULES)[number];
export type SizeLimits = Readonly<Record<SizeRule, number | "off">>;
export declare const SOURCE_LIMITS: {
    readonly "max-lines": 400;
    readonly "max-lines-per-function": 100;
    readonly "max-statements": 30;
    readonly "readability/cognitive-complexity": 15;
    readonly "max-depth": 4;
};
export declare const TEST_LIMITS: {
    readonly "max-lines": 600;
    readonly "max-lines-per-function": "off";
    readonly "max-statements": 50;
    readonly "readability/cognitive-complexity": 15;
    readonly "max-depth": 4;
};
export declare const SOURCES: readonly ["**/*.ts", "**/*.tsx", "**/*.mts", "**/*.cts"];
export declare const TESTS: readonly ["tests/**", "**/*.test.ts", "**/*.test.tsx"];
export declare const base: OxlintConfig;
export declare function sizeBudget(files: readonly string[], limits: SizeLimits, excludeFiles?: readonly string[]): OxlintOverride;
export declare function effectRules(files: readonly string[], excludeFiles?: readonly string[]): OxlintOverride;
export declare function defineConfig({ effect, rules, overrides, options, ...rest }: ChecksConfig): OxlintConfig;
export {};
