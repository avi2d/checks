import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { availableParallelism } from "node:os";
import { fileURLToPath } from "node:url";

const presetPath = fileURLToPath(new URL("../../../stryker.preset.js", import.meta.url));

const loadPresetInSubprocess = (env: Record<string, string>): { concurrency: number; ignoreStatic: boolean } => {
  const script = "import preset from " + JSON.stringify(presetPath) + "; console.log(JSON.stringify({ concurrency: preset.concurrency, ignoreStatic: preset.ignoreStatic }));";
  const result = spawnSync(process.execPath, ["-e", script], { env: { ...process.env, ...env }, encoding: "utf8" });
  expect(result.status).toBe(0);
  return JSON.parse(result.stdout);
};

test("rejects a preset hard-wired to half the cores or to ignoreStatic true by using every core without ignoreStatic on a hosted baseline run", () => {
  const loaded = loadPresetInSubprocess({ RUNNER_ENVIRONMENT: "github-hosted", CHECKS_MUTATION_MODE: "baseline" });
  expect(loaded.concurrency).toBe(availableParallelism());
  expect(loaded.ignoreStatic).toBe(false);
});

test("rejects a preset hard-wired to ignoreStatic false or to full cores everywhere by halving cores with ignoreStatic on in a self-hosted refresh run", () => {
  const loaded = loadPresetInSubprocess({ CHECKS_MUTATION_MODE: "refresh", RUNNER_ENVIRONMENT: "self-hosted" });
  expect(loaded.ignoreStatic).toBe(true);
  expect(loaded.concurrency).toBe(Math.max(1, Math.floor(availableParallelism() / 2)));
});
