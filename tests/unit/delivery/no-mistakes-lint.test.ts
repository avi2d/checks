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

test("a lint command that runs oxlint alone fails, since the typecheck and the docs build must run too", () => {
  const lint = lintCommand();
  for (const step of ["bun run lint", "bun run typecheck", "bun run build"]) {
    expect(lint).toEqual(expect.stringContaining(step));
  }
});
