import { $ } from "bun";
import { expect, test } from "bun:test";
import { chmod, copyFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Schema } from "effect";
import { nativePlatform } from "../../../src/core/native-platforms.ts";
import { skipReason } from "../../../src/testing/test-skips.ts";
import { installConsumer } from "../lib/consumer-install.ts";
import { CHECKOUT, ran, scratchDirs } from "../lib/fixture-repo.ts";

const scratch = scratchDirs();
const stage = join(CHECKOUT, "scripts", "package-release.ts");
const versionFrom = Schema.decodeSync(Schema.fromJsonString(Schema.Struct({ version: Schema.String })));

test("staging keeps native binaries out of the main package and never points it at a different platform version", async () => {
  const assets = await scratch("checks-release-assets-");
  await writeFile(join(assets, "checks-darwin-arm64"), "darwin artifact");
  await writeFile(join(assets, "checks-linux-x64"), "linux artifact");

  const main = join(assets, "package.json");
  await $`bun ${stage} stage ${assets}`.quiet();
  await $`bun ${stage} manifest ${main}`.quiet();

  const { version } = versionFrom(await readFile(join(CHECKOUT, "package.json"), "utf8"));
  const binary = "checks-" + version;
  const scoped = join(assets, "npm", "@avi2dg");
  expect((await readdir(scoped)).sort()).toEqual(["checks-darwin-arm64", "checks-linux-x64"]);
  expect(JSON.parse(await readFile(main, "utf8"))).toMatchObject({
    version,
    optionalDependencies: { "@avi2dg/checks-darwin-arm64": version, "@avi2dg/checks-linux-x64": version },
  });
  for (const [os, cpu] of [["darwin", "arm64"], ["linux", "x64"]]) {
    const name = `@avi2dg/checks-${os}-${cpu}`;
    const directory = join(assets, "npm", name);
    expect((await readdir(directory)).sort()).toEqual([binary, "package.json"]);
    expect(JSON.parse(await readFile(join(directory, "package.json"), "utf8"))).toMatchObject({
      name, version, os: [os], cpu: [cpu], files: [binary],
    });
    expect(await readFile(join(directory, binary), "utf8")).toBe(os + " artifact");
  }
});

test.skipIf(nativePlatform === undefined)(skipReason("the launcher runs a compiled build only on macOS arm64 and Linux x64", "the launcher ignores an older optional binary and prefers the matching binary over source", "local"), async () => {
  const pack = await scratch("checks-release-pack-");
  const app = await scratch("checks-release-app-");
  const packed = await $`bun pm pack --destination ${pack} --quiet --ignore-scripts`.cwd(CHECKOUT).quiet();
  await installConsumer(app, "file:" + packed.stdout.toString().trim());
  await $`git init -q`.cwd(app).quiet();
  await writeFile(join(app, "checks.config.ts"), 'import { defineConfig } from "@avi2dg/checks/config";\nexport default defineConfig({ releaseAssets: true });\n');

  const root = join(app, "node_modules/@avi2dg/checks");
  const platform = `${process.platform}-${process.arch}`;
  const optional = join(app, "node_modules/@avi2dg", "checks-" + platform);
  const older = join(optional, "checks-0.0.0");
  const { version } = versionFrom(await readFile(join(root, "package.json"), "utf8"));
  const binary = join(optional, "checks-" + version);
  const check = () => ran($`bunx --no-install checks-workflows --write`.cwd(app));

  await mkdir(optional, { recursive: true });
  await writeFile(older, "#!/bin/sh\necho older-binary\n");
  await chmod(older, 0o755);
  const fallback = await check();
  expect(fallback.exitCode).toBe(2);
  expect(fallback.text).toContain("package.json defines no release:assets script");

  await $`bun run release:assets ${pack}`.cwd(CHECKOUT).quiet();
  await copyFile(join(pack, "checks-" + platform), binary);
  await chmod(binary, 0o755);
  await writeFile(join(root, "src/delivery/workflows.ts"), 'console.error("source launcher");\nprocess.exitCode = 1;\n');
  expect(await check()).toEqual(fallback);
}, 180_000);
