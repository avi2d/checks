import type { KnipConfiguration } from "knip";

export type ChecksKnipConfig = Omit<KnipConfiguration, "entry" | "include"> & {
  readonly entry: readonly string[];
};

// Knip's dependency-cruiser plugin knows only the dotted config names, so it would report this one as an unused file.
export const DEFAULT_ENTRY = ["tests/**/*.test.ts", "dependency-cruiser.config.ts"] as const;

const REFUSED_ENTRY = "@avi2dg/checks/knip: set entry to the files nothing imports, or [] when package.json scripts and tests name them all";

function isGlobList(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((glob) => typeof glob === "string" && glob !== "");
}

export function defineConfig({ entry, ...rest }: ChecksKnipConfig): KnipConfiguration {
  // The type refuses a missing entry, and the guard repeats it for a config no typecheck reads.
  if (!isGlobList(entry)) throw new TypeError(REFUSED_ENTRY);
  return { include: ["files"], ...rest, entry: [...new Set([...entry, ...DEFAULT_ENTRY])] };
}
