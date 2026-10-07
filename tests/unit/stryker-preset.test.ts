import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { availableParallelism } from "node:os";
import { fileURLToPath } from "node:url";
import { Schema } from "effect";

const presetUrl = new URL("../../stryker.preset.js", import.meta.url).href;
const preset: unknown = (await import(presetUrl)).default;
const { halfAvailableCores }: { halfAvailableCores: (cores?: number) => number } = await import(presetUrl);

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
    concurrency: halfAvailableCores(),
    thresholds: { high: 85, low: 70, break: null },
  });
});

test("mutation concurrency halves the cores, rounds down, and never drops below one", () => {
  expect(halfAvailableCores(16)).toBe(8);
  expect(halfAvailableCores(7)).toBe(3);
  expect(halfAvailableCores(2)).toBe(1);
  expect(halfAvailableCores(1)).toBe(1);
});

test("the preset spreads that cap to every consumer", () => {
  expect(preset).toMatchObject({ concurrency: Math.max(1, Math.floor(availableParallelism() / 2)) });
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
