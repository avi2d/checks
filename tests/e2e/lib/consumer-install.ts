import { $ } from "bun";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

export function consumerManifest(checks: string): Record<string, unknown> {
  return {
    name: "checks-consumer-fixture",
    type: "module",
    author: "avi2d <avi2dg@gmail.com>",
    devDependencies: {
      "@avi2dg/checks": checks,
      effect: "4.0.0",
      oxlint: "1.83.0",
      "@swc/core": "1.16.2",
      "@types/bun": "1.4.2",
    },
  };
}

export async function installConsumer(installDir: string, checks: string): Promise<void> {
  await writeFile(join(installDir, "package.json"), JSON.stringify(consumerManifest(checks)));
  await $`bun install`.cwd(installDir).quiet();
}
