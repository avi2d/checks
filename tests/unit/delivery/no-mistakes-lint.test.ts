import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const CONFIG = join(import.meta.dir, "../../../.no-mistakes.yaml");

function lintCommand(): unknown {
  const config: unknown = Bun.YAML.parse(readFileSync(CONFIG, "utf8"));
  if (typeof config !== "object" || config === null || !("commands" in config)) return undefined;
  const { commands } = config;
  if (typeof commands !== "object" || commands === null || !("lint" in commands)) return undefined;
  return commands.lint;
}

test("a lint command that omits the drift check or masks a step failure fails", () => {
  const lint = lintCommand();
  expect(typeof lint === "string" ? lint.split("&&").map((step) => step.trim()) : lint).toEqual([
    "bun run lint",
    "bun run build",
    "git diff --exit-code",
    "bun run typecheck",
  ]);
});
