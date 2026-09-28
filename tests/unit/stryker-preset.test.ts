import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Schema } from "effect";

const preset: unknown = (await import(new URL("../../stryker.preset.js", import.meta.url).href)).default;

const Manifest = Schema.fromJsonString(
  Schema.Struct({ files: Schema.Array(Schema.String), exports: Schema.Record(Schema.String, Schema.String) }),
);

test("the preset carries exactly the agreed rollout settings, the full-run guard and no ignoreStatic", () => {
  expect(preset).toEqual({
    packageManager: "npm",
    plugins: [
      "@stryker-mutator/*",
      "@hughescr/stryker-bun-runner",
      fileURLToPath(new URL("../../src/testing/mutation-guard-plugin.js", import.meta.url)),
    ],
    ignorers: ["checks-incremental-report-guard"],
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
    await readFile(new URL("../../package.json", import.meta.url), "utf8"),
  );
  expect(manifest.files).toContain("stryker.preset.js");
  expect(manifest.exports["./stryker.preset.js"]).toBe("./stryker.preset.js");
  expect(manifest.files).toContain("src/testing/mutation-guard-plugin.js");
  expect(manifest.files).toContain("src/testing/mutation-scope.js");
});
