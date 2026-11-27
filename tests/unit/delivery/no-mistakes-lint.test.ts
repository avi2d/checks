import { expect, test } from "bun:test";
import { noMistakesLintCommand } from "../../lib/no-mistakes-config.ts";

test("a lint command that omits the drift check or masks a step failure fails", () => {
  const lint = noMistakesLintCommand();
  expect(typeof lint === "string" ? lint.split("&&").map((step) => step.trim()) : lint).toEqual([
    "bun run lint",
    "git add -A",
    "bun run build",
    "git diff --exit-code",
    "bun run typecheck",
  ]);
});
