import { $ } from "bun";
import { readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

export function consumerManifest(checks: string): Record<string, unknown> {
  return {
    name: "checks-consumer-fixture",
    type: "module",
    author: "avi2d <avi2dg@gmail.com>",
    devDependencies: {
      "@avi2dg/checks": checks,
      effect: "4.1.4",
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

export async function installPackedConsumer(checkout: string, packDir: string, installDir: string): Promise<string> {
  const packed = await $`bun pm pack --destination ${packDir} --quiet --ignore-scripts`.cwd(checkout).quiet();
  const tarball = packed.stdout.toString().trim();
  await installConsumer(installDir, `file:${tarball}`);
  return tarball;
}

export async function resetConsumer(dir: string): Promise<void> {
  for (const entry of await readdir(dir)) {
    if (entry === "node_modules" || entry === "bun.lock") continue;
    await rm(join(dir, entry), { recursive: true, force: true });
  }
}
