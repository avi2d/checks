import { $ } from "bun";
import { expect, test } from "bun:test";
import { join } from "node:path";
import { CHECKOUT } from "./lib/fixture-repo.ts";

test(
  "the repo cruise parses its own TypeScript under effect-channel, scripts and tests",
  async () => {
    const binary = join(CHECKOUT, "node_modules", ".bin", "depcruise");
    const result = await $`${binary} --config .dependency-cruiser.cjs --output-type json .`
      .cwd(CHECKOUT)
      .nothrow()
      .quiet();
    const sources: string[] = JSON.parse(result.stdout.toString()).modules.map((module: { source: string }) => module.source);
    const typescriptUnder = (folder: string) => sources.filter((source) => source.startsWith(`${folder}/`) && source.endsWith(".ts"));
    expect(typescriptUnder("effect-channel")).not.toHaveLength(0);
    expect(typescriptUnder("scripts")).not.toHaveLength(0);
    expect(typescriptUnder("tests")).not.toHaveLength(0);
  },
  60_000,
);
