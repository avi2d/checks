import { $ } from "bun";
import { readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

export function widgetTest(widget: string): string {
  return `import { expect, test } from "bun:test";\nimport { widget } from "${widget}";\ntest("widget", () => {\n  expect(widget).toBe(42);\n});\n`;
}

export function manifestFor(checks: string): Record<string, unknown> {
  return {
    name: "checks-consumer-fixture",
    type: "module",
    devDependencies: {
      "@avi2dg/checks": checks,
      effect: "4.0.0-rc.115",
      oxlint: "1.83.0",
      "@swc/core": "1.16.2",
      "@types/bun": "1.4.2",
    },
  };
}

export async function installConsumer(installDir: string, checks: string): Promise<void> {
  await writeFile(join(installDir, "package.json"), JSON.stringify(manifestFor(checks)));
  await $`bun install`.cwd(installDir).quiet();
}

// Every dependency and its version are the same across every fixture, so one
// `bun install` per kind serves every test that uses it.
const KEPT_ACROSS_TESTS = new Set(["node_modules", "bun.lock"]);

export async function resetWorkspace(workDir: string): Promise<void> {
  for (const entry of await readdir(workDir)) {
    if (KEPT_ACROSS_TESTS.has(entry)) continue;
    await rm(join(workDir, entry), { recursive: true, force: true });
  }
}
