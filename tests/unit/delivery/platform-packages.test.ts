import { expect, test } from "bun:test";
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { HOSTED_PLATFORMS, stagePlatformPackages, withOptionalDependencies, type PlatformRelease } from "../../../src/delivery/platform-packages.ts";
import { run } from "../../../src/testing/run-effect.ts";

const MANIFEST = { name: "@acme/cli", version: "2.3.4", license: "MIT", repository: { type: "git", url: "git+https://github.com/acme/cli.git" }, publishConfig: { access: "public" } };

const releaseIn = (directory: string): PlatformRelease => ({ directory, binary: "acme", manifest: MANIFEST, platforms: [HOSTED_PLATFORMS["linux-arm64"], HOSTED_PLATFORMS["darwin-x64"]] });

test("a consumer's platform packages hold only the versioned binary under the main package's name and version, and only Linux packages narrow libc, so npm never installs a glibc build on musl or a binary of another release", async () => {
  const directory = await mkdtemp(join(tmpdir(), "checks-platform-packages-"));
  try {
    await writeFile(join(directory, "acme-linux-arm64"), "linux arm64 build");
    await writeFile(join(directory, "acme-darwin-x64"), "darwin x64 build");
    await run(stagePlatformPackages(releaseIn(directory)));
    expect((await readdir(join(directory, "npm", "@acme"))).sort()).toEqual(["cli-darwin-x64", "cli-linux-arm64"]);
    const linux = join(directory, "npm", "@acme", "cli-linux-arm64");
    expect((await readdir(linux)).sort()).toEqual(["acme-2.3.4", "package.json"]);
    expect(await readFile(join(linux, "acme-2.3.4"), "utf8")).toBe("linux arm64 build");
    expect((await stat(join(linux, "acme-2.3.4"))).mode & 0o111).toBe(0o111);
    expect(JSON.parse(await readFile(join(linux, "package.json"), "utf8"))).toEqual({
      name: "@acme/cli-linux-arm64", version: "2.3.4", os: ["linux"], cpu: ["arm64"], libc: ["glibc"], files: ["acme-2.3.4"],
      license: MANIFEST.license, repository: MANIFEST.repository, publishConfig: MANIFEST.publishConfig,
    });
    const darwin = JSON.parse(await readFile(join(directory, "npm", "@acme", "cli-darwin-x64", "package.json"), "utf8"));
    expect(darwin).toMatchObject({ name: "@acme/cli-darwin-x64", os: ["darwin"], cpu: ["x64"] });
    expect(darwin).not.toHaveProperty("libc");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("staging refuses a platform whose binary was not built, instead of publishing a platform package with no binary", async () => {
  const directory = await mkdtemp(join(tmpdir(), "checks-platform-packages-"));
  try {
    await writeFile(join(directory, "acme-linux-arm64"), "linux arm64 build");
    const failure = await run(Effect.flip(stagePlatformPackages(releaseIn(directory))));
    expect(failure.message).toBe(join(directory, "acme-darwin-x64") + " is missing, so the @acme/cli-darwin-x64 package has no binary to hold");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("the main manifest gains each platform package at its own version and keeps the optional dependencies it held, so a release never drops one or points at another version", () => {
  const held = { ...MANIFEST, optionalDependencies: { fsevents: "^2.3.0" } };
  expect(withOptionalDependencies(held, releaseIn("unused"))).toEqual({
    ...MANIFEST,
    optionalDependencies: { fsevents: "^2.3.0", "@acme/cli-linux-arm64": "2.3.4", "@acme/cli-darwin-x64": "2.3.4" },
  });
});
