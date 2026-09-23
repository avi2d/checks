import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

const preset = (
  await import(new URL("../stryker.preset.js", import.meta.url).href)
).default as Record<string, unknown>;

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
  const manifest = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  ) as { files: readonly string[]; exports: Record<string, string> };
  expect(manifest.files).toContain("stryker.preset.js");
  expect(manifest.exports["./stryker.preset.js"]).toBe("./stryker.preset.js");
});
