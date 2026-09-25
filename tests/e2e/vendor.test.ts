import { $ } from "bun";
import { afterEach, expect, test } from "bun:test";
import { appendFile, chmod, mkdir, readlink, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { remoteSegments, tagFor } from "../../scripts/vendor.ts";
import { CHECKOUT, ran, scratchDirs, type Ran } from "./lib/fixture-repo.ts";

const VENDOR = join(CHECKOUT, "scripts", "vendor.ts");
const TEMPLATE = "fake-lib@{version}";
const IDENTITY = ["-c", "user.name=Wren Fixture", "-c", "user.email=wren@example.com"];

const caches: string[] = [];

afterEach(async () => {
  for (const cache of caches.splice(0)) await $`chmod -R u+w ${cache}`.quiet().nothrow();
});

const scratch = scratchDirs();

async function scratchCache(): Promise<string> {
  const cache = await scratch("checks-vendor-cache-");
  caches.push(cache);
  return cache;
}

type Remote = {
  readonly remote: string;
  readonly work: string;
};

function manifest(version: string): string {
  return JSON.stringify({ name: "fake-lib", version });
}

async function seedRemote(parent: string, version: string, tag: string): Promise<Remote> {
  const work = join(parent, "work");
  const remote = join(parent, "remote.git");
  await mkdir(work, { recursive: true });
  await $`git init -q -b main`.cwd(work).quiet();
  await writeFile(join(work, "package.json"), manifest(version));
  await writeFile(join(work, "index.ts"), "export const value = 1;\n");
  await $`git add -A && git ${IDENTITY} commit -q --no-gpg-sign -m seed`.cwd(work).quiet();
  await $`git ${IDENTITY} tag -a -m seed ${tag}`.cwd(work).quiet();
  await $`git init -q --bare ${remote}`.cwd(parent).quiet();
  await $`git remote add origin ${remote}`.cwd(work).quiet();
  await $`git push -q origin main --tags`.cwd(work).quiet();
  return { remote, work };
}

async function moveTag(remote: Remote, version: string, tag: string): Promise<void> {
  await writeFile(join(remote.work, "package.json"), `${manifest(version)}\n`);
  await $`git add -A && git ${IDENTITY} commit -q --no-gpg-sign -m moved`.cwd(remote.work).quiet();
  await $`git ${IDENTITY} tag -f -a -m moved ${tag}`.cwd(remote.work).quiet();
  await $`git push -q -f origin main --tags`.cwd(remote.work).quiet();
}

async function seedConsumer(dir: string, remote: string, installed: string): Promise<void> {
  await $`git init -q -b main`.cwd(dir).quiet();
  await mkdir(join(dir, "node_modules", "fake-lib"), { recursive: true });
  await writeFile(join(dir, "node_modules", "fake-lib", "package.json"), manifest(installed));
  await writeFile(
    join(dir, "quality.json"),
    JSON.stringify({ sources: { libraries: [{ name: "fake-lib", package: "fake-lib", repository: remote, tag: TEMPLATE }] } }),
  );
}

function vendor(dir: string, cache: string): Promise<Ran> {
  return ran($`bun ${VENDOR}`.cwd(dir).env({ ...process.env, CHECKS_VENDOR_CACHE: cache }));
}

function cachedDir(cache: string, remote: string, version: string): string {
  return join(cache, "repos", ...remoteSegments(remote), tagFor(TEMPLATE, version));
}

test(
  "a declared library pins the installed version to a shared clone and links it",
  async () => {
    const cache = await scratchCache();
    const parent = await scratch("checks-vendor-remote-");
    const consumer = await scratch("checks-vendor-consumer-");
    const { remote } = await seedRemote(parent, "1.0.0", "fake-lib@1.0.0");
    await seedConsumer(consumer, remote, "1.0.0");

    const first = await vendor(consumer, cache);
    expect(first.exitCode).toBe(0);
    expect(first.text).toContain("cloned fake-lib@1.0.0");
    const dir = cachedDir(cache, remote, "1.0.0");
    expect(await readlink(join(consumer, "repos", "fake-lib"))).toBe(dir);
    expect((await stat(join(dir, "package.json"))).mode & 0o222).toBe(0);

    const second = await vendor(consumer, cache);
    expect(second.exitCode).toBe(0);
    expect(second.text).toContain("still holds fake-lib@1.0.0");
  },
  60_000,
);

test(
  "a landed manifest naming another version fails the run",
  async () => {
    const cache = await scratchCache();
    const parent = await scratch("checks-vendor-remote-");
    const consumer = await scratch("checks-vendor-consumer-");
    const { remote } = await seedRemote(parent, "2.0.0", "fake-lib@1.0.0");
    await seedConsumer(consumer, remote, "1.0.0");

    const result = await vendor(consumer, cache);
    expect(result.exitCode).not.toBe(0);
    expect(result.text).toContain("holds version 2.0.0, not the installed 1.0.0");
  },
  60_000,
);

test(
  "a tag moved after the first fetch fails the run",
  async () => {
    const cache = await scratchCache();
    const parent = await scratch("checks-vendor-remote-");
    const consumer = await scratch("checks-vendor-consumer-");
    const seed = await seedRemote(parent, "1.0.0", "fake-lib@1.0.0");
    await seedConsumer(consumer, seed.remote, "1.0.0");
    expect((await vendor(consumer, cache)).exitCode).toBe(0);

    await moveTag(seed, "1.0.0", "fake-lib@1.0.0");
    const result = await vendor(consumer, cache);
    expect(result.exitCode).not.toBe(0);
    expect(result.text).toContain("not the recorded");
  },
  60_000,
);

test(
  "a write into the cached tree fails the run",
  async () => {
    const cache = await scratchCache();
    const parent = await scratch("checks-vendor-remote-");
    const consumer = await scratch("checks-vendor-consumer-");
    const { remote } = await seedRemote(parent, "1.0.0", "fake-lib@1.0.0");
    await seedConsumer(consumer, remote, "1.0.0");
    expect((await vendor(consumer, cache)).exitCode).toBe(0);

    const file = join(cachedDir(cache, remote, "1.0.0"), "index.ts");
    await chmod(file, 0o644);
    await appendFile(file, "// tampered\n");
    const exposed = await vendor(consumer, cache);
    expect(exposed.exitCode).not.toBe(0);
    expect(exposed.text).toContain("writable");

    await chmod(file, 0o444);
    const hidden = await vendor(consumer, cache);
    expect(hidden.exitCode).not.toBe(0);
    expect(hidden.text).toContain("outside the recorded commit");
  },
  60_000,
);
