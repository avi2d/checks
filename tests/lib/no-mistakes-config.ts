import { readFileSync } from "node:fs";
import { join } from "node:path";

const CONFIG = join(import.meta.dir, "../../.no-mistakes.yaml");

export function noMistakesLintCommand(): unknown {
  const config: unknown = Bun.YAML.parse(readFileSync(CONFIG, "utf8"));
  if (typeof config !== "object" || config === null || !("commands" in config)) return undefined;
  const { commands } = config;
  if (typeof commands !== "object" || commands === null || !("lint" in commands)) return undefined;
  return commands.lint;
}
