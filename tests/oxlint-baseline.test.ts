import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");

type Override = { readonly files: readonly string[]; readonly rules: Readonly<Record<string, unknown>> };

function read(name: string): unknown {
  return JSON.parse(readFileSync(join(ROOT, name), "utf8"));
}

// oxlint names a core eslint rule in the baseline without its plugin prefix.
function baselineName(rule: string): string {
  return rule.replace(/^eslint\//, "");
}

test("the oxlint baseline counts only the Effect override's rules, in the files it covers", () => {
  const { overrides } = read(".oxlintrc.json") as { overrides: readonly Override[] };
  const effect = overrides.find((override) => "effect-channel/no-throw" in override.rules);
  expect(effect).toBeDefined();
  const rules = new Set(Object.keys(effect?.rules ?? {}).map(baselineName));
  const globs = (effect?.files ?? []).map((pattern) => new Bun.Glob(pattern));

  const baseline = read("oxlint-suppressions.json") as Record<string, Record<string, unknown>>;
  const outside = Object.entries(baseline).flatMap(([file, counted]) => [
    ...(globs.some((glob) => glob.match(file)) ? [] : [`${file} is outside ${effect?.files.join(", ")}`]),
    ...Object.keys(counted)
      .filter((rule) => !rules.has(rule))
      .map((rule) => `${file} counts ${rule}`),
  ]);
  expect(outside).toEqual([]);
});
