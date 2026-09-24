import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ENTRY_POINT, KIT_GATES, TEST_ENTRY_POINT } from "../scripts/gates.ts";

const OUTSIDE_LINT = {
  "checks-backtest": "scripts/backtest.ts",
  "checks-mutation-compare": "scripts/mutation-compare.ts",
};

test("every bin is an entry point, a gate the lint entry point runs, or a tool outside lint", () => {
  const manifest: unknown = JSON.parse(readFileSync(resolve(import.meta.dir, "..", "package.json"), "utf8"));
  const run = [ENTRY_POINT, TEST_ENTRY_POINT, ...KIT_GATES].map((program) => [program.bin, `scripts/${program.script}`]);
  expect(manifest).toHaveProperty("bin", { ...Object.fromEntries(run), ...OUTSIDE_LINT });
});
