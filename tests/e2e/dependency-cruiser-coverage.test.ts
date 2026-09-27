import { $ } from "bun";
import { expect, test } from "bun:test";
import { join } from "node:path";
import { CHECKOUT } from "./lib/fixture-repo.ts";

const SOURCE_FOLDERS = [
  "src/core",
  "src/complexity",
  "src/complexity/readability",
  "src/quality",
  "src/quality/effect-channel",
  "src/testing",
  "src/docs",
  "src/delivery",
  "src/dependencies",
  "scripts",
  "tests",
] as const;

test(
  "the repo cruise parses its own TypeScript under each src/ vector, both plugins, scripts and tests",
  async () => {
    const binary = join(CHECKOUT, "node_modules", ".bin", "depcruise");
    const result = await $`${binary} --config .dependency-cruiser.cjs --output-type json .`
      .cwd(CHECKOUT)
      .nothrow()
      .quiet();
    const sources: string[] = JSON.parse(result.stdout.toString()).modules.map((module: { source: string }) => module.source);
    const typescriptUnder = (folder: string) => sources.filter((source) => source.startsWith(`${folder}/`) && source.endsWith(".ts"));
    expect(SOURCE_FOLDERS.filter((folder) => typescriptUnder(folder).length === 0)).toEqual([]);
  },
  60_000,
);
