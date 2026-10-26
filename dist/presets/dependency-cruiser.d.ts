import type { IConfiguration, ICruiseOptions } from "dependency-cruiser";
type CruiseOptions = Omit<ICruiseOptions, "builtInModules"> & {
    readonly builtInModules?: Partial<NonNullable<ICruiseOptions["builtInModules"]>>;
};
export type CruiseConfig = Omit<IConfiguration, "extends" | "options"> & {
    readonly options?: CruiseOptions;
};
export type ChecksCruiseConfig = CruiseConfig & {
    readonly devOnly?: readonly string[];
    readonly orphans?: readonly string[];
};
export declare const DEV_ONLY: readonly ["^tests/"];
export declare const base: CruiseConfig;
export declare function defineConfig({ devOnly, orphans, forbidden, options, ...rest }?: ChecksCruiseConfig): CruiseConfig;
export {};
