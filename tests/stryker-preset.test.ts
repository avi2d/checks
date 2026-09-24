import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { Schema } from "effect";

const preset: unknown = (await import(new URL("../stryker.preset.js", import.meta.url).href)).default;

const Manifest = Schema.fromJsonString(
  Schema.Struct({ files: Schema.Array(Schema.String), exports: Schema.Record(Schema.String, Schema.String) }),
);

test("the preset carries exactly the agreed rollout settings and no ignoreStatic", () => {
  expect(preset).toEqual({
    packageManager: "npm",
    plugins: ["@stryker-mutator/*", "@hughescr/stryker-bun-runner"],
    testRunner: "bun",
    bun: { timeout: 60000 },
    inPlace: true,
    tempDirName: "../.stryker-tmp",
    coverageAnalysis: "perTest",
    reporters: ["html", "json", "clear-text", "progress"],
    timeoutMS: 60000,
    concurrency: 8,
    thresholds: { high: 85, low: 70, break: null },
  });
});

test("the preset ships the way every other shared artifact is exposed", async () => {
  const manifest = Schema.decodeSync(Manifest)(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );
  expect(manifest.files).toContain("stryker.preset.js");
  expect(manifest.exports["./stryker.preset.js"]).toBe("./stryker.preset.js");
});
