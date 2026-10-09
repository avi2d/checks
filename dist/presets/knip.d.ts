import type { KnipConfiguration } from "knip";
export type ChecksKnipConfig = Omit<KnipConfiguration, "entry" | "include"> & {
    readonly entry: readonly string[];
};
export declare const DEFAULT_ENTRY: readonly ["tests/**/*.test.ts", "dependency-cruiser.config.ts"];
export declare function defineConfig({ entry, ...rest }: ChecksKnipConfig): KnipConfiguration;
