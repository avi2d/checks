import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { Schema } from "effect";

const ROOT = resolve(import.meta.dir, "..");

const Config = Schema.fromJsonString(
  Schema.Struct({
    overrides: Schema.Array(
      Schema.Struct({ files: Schema.Array(Schema.String), rules: Schema.Record(Schema.String, Schema.Unknown) }),
    ),
  }),
);

const Baseline = Schema.fromJsonString(Schema.Record(Schema.String, Schema.Record(Schema.String, Schema.Unknown)));

function read(name: string): string {
  return readFileSync(join(ROOT, name), "utf8");
}

// oxlint names a core eslint rule in the baseline without its plugin prefix.
function baselineName(rule: string): string {
  return rule.replace(/^eslint\//, "");
}

test("the oxlint baseline counts only the Effect override's rules, in the files it covers", () => {
  const { overrides } = Schema.decodeSync(Config)(read(".oxlintrc.json"));
  const effect = overrides.find((override) => "effect-channel/no-throw" in override.rules);
  expect(effect).toBeDefined();
  const rules = new Set(Object.keys(effect?.rules ?? {}).map(baselineName));
  const globs = (effect?.files ?? []).map((pattern) => new Bun.Glob(pattern));

  const baseline = Schema.decodeSync(Baseline)(read("oxlint-suppressions.json"));
  const outside = Object.entries(baseline).flatMap(([file, counted]) => [
    ...(globs.some((glob) => glob.match(file)) ? [] : [`${file} is outside ${effect?.files.join(", ")}`]),
    ...Object.keys(counted)
      .filter((rule) => !rules.has(rule))
      .map((rule) => `${file} counts ${rule}`),
  ]);
  expect(outside).toEqual([]);
});
