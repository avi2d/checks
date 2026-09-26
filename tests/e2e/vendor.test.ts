import { $ } from "bun";
import { afterEach, expect, test } from "bun:test";
import { appendFile, chmod, lstat, mkdir, readdir, readFile, readlink, rm, stat, symlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { remoteSegments, tagFor } from "../../scripts/vendor.ts";
import { CHECKOUT, ran, scratchDirs, type Ran } from "./lib/fixture-repo.ts";

const VENDOR = join(CHECKOUT, "scripts", "vendor.ts");
const TEMPLATE = "fake-lib@{version}";
const IDENTITY = ["-c", "user.name=Wren Fixture", "-c", "user.email=wren@example.com"];

const homes: string[] = [];

afterEach(async () => {
  for (const home of homes.splice(0)) await $`chmod -R u+w ${home}`.quiet().nothrow();
});

const scratch = scratchDirs();

async function scratchHome(): Promise<string> {
  const home = await scratch("checks-vendor-home-");
  homes.push(home);
  return home;
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
  await writeFile(join(work, ".gitignore"), "node_modules/\n");
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

const remotes = new Map<string, string>();

function libraryArgs(remote: string): readonly string[] {
  return ["--library", "fake-lib", "--package", "fake-lib", "--repository", remote, "--tag", TEMPLATE];
}

async function seedConsumer(dir: string, remote: string, installed: string): Promise<void> {
  remotes.set(dir, remote);
  await $`git init -q -b main`.cwd(dir).quiet();
  await mkdir(join(dir, "node_modules", "fake-lib"), { recursive: true });
  await writeFile(join(dir, "node_modules", "fake-lib", "package.json"), manifest(installed));
  const prepare = `bun '${VENDOR}' ${libraryArgs(remote).map((arg) => `'${arg}'`).join(" ")}`;
  await writeFile(join(dir, "package.json"), JSON.stringify({ name: "consumer", scripts: { prepare } }));
}

function homeEnv(home: string): Record<string, string | undefined> {
  return { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("XDG_"))), HOME: home };
}

function vendorWith(dir: string, home: string, args: readonly string[], umask = "022"): Promise<Ran> {
  return ran($`sh -c ${`umask ${umask} && exec bun "$0" "$@"`} ${VENDOR} ${args}`.cwd(dir).env(homeEnv(home)));
}

function vendor(dir: string, home: string, umask = "022"): Promise<Ran> {
  return vendorWith(dir, home, libraryArgs(remotes.get(dir) ?? ""), umask);
}

function linked(consumer: string): Promise<boolean> {
  return lstat(join(consumer, "repos", "fake-lib")).then(
    () => true,
    () => false,
  );
}

function cachedDir(home: string, remote: string, version: string): string {
  return join(home, ".cache", "avi2dg-checks", "repos", ...remoteSegments(remote), tagFor(TEMPLATE, version));
}

test(
  "a declared library pins the installed version to a shared clone and links it",
  async () => {
    const home = await scratchHome();
    const parent = await scratch("checks-vendor-remote-");
    const consumer = await scratch("checks-vendor-consumer-");
    const { remote } = await seedRemote(parent, "1.0.0", "fake-lib@1.0.0");
    await seedConsumer(consumer, remote, "1.0.0");

    const first = await ran($`bun run prepare`.cwd(consumer).env(homeEnv(home)));
    expect(first.exitCode).toBe(0);
    expect(first.text).toContain("cloned fake-lib@1.0.0");
    const dir = cachedDir(home, remote, "1.0.0");
    expect(await readlink(join(consumer, "repos", "fake-lib"))).toBe(dir);
    expect((await stat(join(dir, "package.json"))).mode & 0o222).toBe(0);

    const second = await vendor(consumer, home);
    expect(second.exitCode).toBe(0);
    expect(second.text).toContain("still holds fake-lib@1.0.0");
  },
  60_000,
);

test(
  "under the umask 0 bun gives prepare, nothing the run creates is writable by another user",
  async () => {
    const home = await scratchHome();
    const parent = await scratch("checks-vendor-remote-");
    const consumer = await scratch("checks-vendor-consumer-");
    const { remote } = await seedRemote(parent, "1.0.0", "fake-lib@1.0.0");
    await seedConsumer(consumer, remote, "1.0.0");

    expect((await vendor(consumer, home, "0")).exitCode).toBe(0);
    const cache = join(home, ".cache");
    const created = [cache, ...(await readdir(cache, { recursive: true })).map((entry) => join(cache, entry)), join(consumer, "repos")];
    const shared = [];
    for (const entry of created) {
      const info = await lstat(entry);
      if (!info.isSymbolicLink() && (info.mode & 0o022) !== 0) shared.push(entry);
    }
    expect(shared).toEqual([]);
  },
  60_000,
);

test(
  "two first runs at once land one verified tree and leave no staging behind",
  async () => {
    const home = await scratchHome();
    const parent = await scratch("checks-vendor-remote-");
    const consumers = [await scratch("checks-vendor-consumer-"), await scratch("checks-vendor-consumer-")];
    const { remote } = await seedRemote(parent, "1.0.0", "fake-lib@1.0.0");
    for (const consumer of consumers) await seedConsumer(consumer, remote, "1.0.0");

    const runs = await Promise.all(consumers.map((consumer) => vendor(consumer, home)));
    expect(runs.map((run) => run.exitCode)).toEqual([0, 0]);
    const dir = cachedDir(home, remote, "1.0.0");
    expect((await readdir(dirname(dir))).sort()).toEqual(["fake-lib@1.0.0", "fake-lib@1.0.0.commit"]);
    for (const consumer of consumers) expect(await readlink(join(consumer, "repos", "fake-lib"))).toBe(dir);
  },
  60_000,
);

async function writablePaths(dir: string): Promise<readonly string[]> {
  const found = [];
  for (const entry of [dir, ...(await readdir(dir, { recursive: true })).map((child) => join(dir, child))]) {
    const info = await lstat(entry);
    if (!info.isSymbolicLink() && (info.mode & 0o222) !== 0) found.push(entry);
  }
  return found;
}

async function clearReadOnlyThrough(link: string): Promise<void> {
  await chmod(link, (await stat(link)).mode | 0o200);
  await rm(link);
}

test(
  "a cleanup that makes a link writable before deleting it leaves the next run a frozen tree",
  async () => {
    const home = await scratchHome();
    const parent = await scratch("checks-vendor-remote-");
    const consumers = [await scratch("checks-vendor-consumer-"), await scratch("checks-vendor-consumer-")];
    const { remote } = await seedRemote(parent, "1.0.0", "fake-lib@1.0.0");
    for (const consumer of consumers) await seedConsumer(consumer, remote, "1.0.0");
    const [scratchCheckout = "", ci = ""] = consumers;
    expect((await vendor(scratchCheckout, home)).exitCode).toBe(0);
    const dir = cachedDir(home, remote, "1.0.0");

    await clearReadOnlyThrough(join(scratchCheckout, "repos", "fake-lib"));
    expect(await writablePaths(dir)).toEqual([dir]);
    const next = await vendor(ci, home);
    expect(next).toMatchObject({ exitCode: 0 });
    expect(await writablePaths(dir)).toEqual([]);
    expect(await readlink(join(ci, "repos", "fake-lib"))).toBe(dir);
  },
  60_000,
);

test(
  "a landed manifest naming another version fails the run",
  async () => {
    const home = await scratchHome();
    const parent = await scratch("checks-vendor-remote-");
    const consumer = await scratch("checks-vendor-consumer-");
    const { remote } = await seedRemote(parent, "2.0.0", "fake-lib@1.0.0");
    await seedConsumer(consumer, remote, "1.0.0");

    const result = await vendor(consumer, home);
    expect(result.exitCode).toBe(1);
    expect(result.text).toContain("holds version 2.0.0, not the installed 1.0.0");
    expect(await readdir(dirname(cachedDir(home, remote, "1.0.0")))).toEqual([]);
  },
  60_000,
);

async function clearTree(dir: string): Promise<void> {
  await $`chmod -R u+w ${dir}`.quiet();
  await rm(dir, { recursive: true, force: true });
}

async function tagCommit(work: string, tag: string): Promise<string> {
  return (await $`git rev-parse ${tag}^{commit}`.cwd(work).quiet()).stdout.toString().trim();
}

test(
  "a tag moved upstream fails the fetch that follows a cleared tree, and links nothing",
  async () => {
    const home = await scratchHome();
    const parent = await scratch("checks-vendor-remote-");
    const consumer = await scratch("checks-vendor-consumer-");
    const seed = await seedRemote(parent, "1.0.0", "fake-lib@1.0.0");
    await seedConsumer(consumer, seed.remote, "1.0.0");
    const first = await tagCommit(seed.work, "fake-lib@1.0.0");
    expect((await vendor(consumer, home)).exitCode).toBe(0);
    const dir = cachedDir(home, seed.remote, "1.0.0");

    await moveTag(seed, "1.0.0", "fake-lib@1.0.0");
    expect((await vendor(consumer, home)).exitCode).toBe(0);
    expect((await $`git rev-parse HEAD`.cwd(dir).quiet()).stdout.toString().trim()).toBe(first);

    await clearTree(dir);
    const moved = await vendor(consumer, home);
    expect(moved.exitCode).toBe(1);
    expect(moved.text).toContain(`lands on ${await tagCommit(seed.work, "fake-lib@1.0.0")}, not the recorded ${first}`);
    expect(await linked(consumer)).toBe(false);
    expect(await readdir(dirname(dir))).toEqual(["fake-lib@1.0.0.commit"]);
  },
  60_000,
);

test(
  "deleting the record beside the tree accepts a deliberate move",
  async () => {
    const home = await scratchHome();
    const parent = await scratch("checks-vendor-remote-");
    const consumer = await scratch("checks-vendor-consumer-");
    const seed = await seedRemote(parent, "1.0.0", "fake-lib@1.0.0");
    await seedConsumer(consumer, seed.remote, "1.0.0");
    expect((await vendor(consumer, home)).exitCode).toBe(0);
    const dir = cachedDir(home, seed.remote, "1.0.0");

    await moveTag(seed, "1.0.0", "fake-lib@1.0.0");
    await clearTree(dir);
    await rm(`${dir}.commit`);
    const accepted = await vendor(consumer, home);
    expect(accepted.exitCode).toBe(0);
    const moved = await tagCommit(seed.work, "fake-lib@1.0.0");
    expect((await $`git rev-parse HEAD`.cwd(dir).quiet()).stdout.toString().trim()).toBe(moved);
    expect((await readFile(`${dir}.commit`, "utf8")).trim()).toBe(moved);
    expect(await readlink(join(consumer, "repos", "fake-lib"))).toBe(dir);
  },
  60_000,
);

test(
  "a warm cache verifies without the remote and keeps the link",
  async () => {
    const home = await scratchHome();
    const parent = await scratch("checks-vendor-remote-");
    const consumer = await scratch("checks-vendor-consumer-");
    const { remote } = await seedRemote(parent, "1.0.0", "fake-lib@1.0.0");
    await seedConsumer(consumer, remote, "1.0.0");
    expect((await vendor(consumer, home)).exitCode).toBe(0);

    await rm(remote, { recursive: true, force: true });
    const offline = await vendor(consumer, home);
    expect(offline.exitCode).toBe(0);
    expect(offline.text).toContain("still holds fake-lib@1.0.0");
    expect(await readlink(join(consumer, "repos", "fake-lib"))).toBe(cachedDir(home, remote, "1.0.0"));
  },
  60_000,
);

test(
  "a cold cache with an unreachable remote warns, leaves no link and passes",
  async () => {
    const home = await scratchHome();
    const parent = await scratch("checks-vendor-remote-");
    const consumer = await scratch("checks-vendor-consumer-");
    const { remote } = await seedRemote(parent, "1.0.0", "fake-lib@1.0.0");
    await seedConsumer(consumer, remote, "1.0.0");
    expect((await vendor(consumer, home)).exitCode).toBe(0);

    await rm(remote, { recursive: true, force: true });
    await writeFile(join(consumer, "node_modules", "fake-lib", "package.json"), manifest("2.0.0"));
    const offline = await vendor(consumer, home);
    expect(offline.exitCode).toBe(0);
    expect(offline.text).toContain("cannot list fake-lib@2.0.0");
    expect(offline.text).toContain("stays unlinked");
    expect(await linked(consumer)).toBe(false);
    expect((await readdir(dirname(cachedDir(home, remote, "2.0.0")))).sort()).toEqual(["fake-lib@1.0.0", "fake-lib@1.0.0.commit"]);
  },
  60_000,
);

test(
  "a write into the cached tree fails every run, and the first leaves the tree frozen",
  async () => {
    const home = await scratchHome();
    const parent = await scratch("checks-vendor-remote-");
    const consumer = await scratch("checks-vendor-consumer-");
    const { remote } = await seedRemote(parent, "1.0.0", "fake-lib@1.0.0");
    await seedConsumer(consumer, remote, "1.0.0");
    expect((await vendor(consumer, home)).exitCode).toBe(0);

    const dir = cachedDir(home, remote, "1.0.0");
    const file = join(dir, "index.ts");
    await chmod(file, 0o644);
    await appendFile(file, "// tampered\n");
    const exposed = await vendor(consumer, home);
    expect(exposed.exitCode).toBe(1);
    expect(exposed.text).toContain("outside the recorded commit, starting with M index.ts;");
    expect(await writablePaths(dir)).toEqual([]);
    expect(await linked(consumer)).toBe(false);

    const hidden = await vendor(consumer, home);
    expect(hidden.exitCode).toBe(1);
    expect(hidden.text).toContain("outside the recorded commit");
  },
  60_000,
);

test(
  "a group-writable path fails the run before git reads the tree, and keeps its mode",
  async () => {
    const home = await scratchHome();
    const parent = await scratch("checks-vendor-remote-");
    const consumer = await scratch("checks-vendor-consumer-");
    const { remote } = await seedRemote(parent, "1.0.0", "fake-lib@1.0.0");
    await seedConsumer(consumer, remote, "1.0.0");
    expect((await vendor(consumer, home)).exitCode).toBe(0);
    const dir = cachedDir(home, remote, "1.0.0");
    const config = join(dir, ".git", "config");
    const marker = join(parent, "fsmonitor-ran");
    const hook = join(parent, "fsmonitor.sh");
    await writeFile(hook, `#!/bin/sh\ntouch '${marker}'\n`, { mode: 0o755 });

    await chmod(config, 0o664);
    await appendFile(config, `[core]\n\tfsmonitor = ${hook}\n`);
    const refused = await vendor(consumer, home);
    expect(refused.exitCode).toBe(1);
    expect(refused.text).toContain(`1 path writable by group or others, starting with ${config};`);
    expect((await stat(config)).mode & 0o777).toBe(0o664);
    expect(await Bun.file(marker).exists()).toBe(false);
    expect(await linked(consumer)).toBe(false);
  },
  60_000,
);

test(
  "a record rewritten to another commit is refused even once the tree is writable",
  async () => {
    const home = await scratchHome();
    const parent = await scratch("checks-vendor-remote-");
    const consumer = await scratch("checks-vendor-consumer-");
    const seed = await seedRemote(parent, "1.0.0", "fake-lib@1.0.0");
    await seedConsumer(consumer, seed.remote, "1.0.0");
    expect((await vendor(consumer, home)).exitCode).toBe(0);
    const dir = cachedDir(home, seed.remote, "1.0.0");
    const landed = (await readFile(`${dir}.commit`, "utf8")).trim();
    await $`git ${IDENTITY} commit -q --no-gpg-sign --allow-empty -m other`.cwd(seed.work).quiet();
    const forged = (await $`git rev-parse HEAD`.cwd(seed.work).quiet()).stdout.toString().trim();
    expect(forged).not.toBe(landed);

    await writeFile(`${dir}.commit`, `${forged}\n`);
    await clearReadOnlyThrough(join(consumer, "repos", "fake-lib"));
    const refused = await vendor(consumer, home);
    expect(refused.exitCode).toBe(1);
    expect(refused.text).toContain(`sits on ${landed}, not the recorded ${forged}`);
    expect(await linked(consumer)).toBe(false);
  },
  60_000,
);

test(
  "runs that find the tree writable at once all pass, and leave it frozen",
  async () => {
    const home = await scratchHome();
    const parent = await scratch("checks-vendor-remote-");
    const consumers = [];
    for (let index = 0; index < 4; index += 1) consumers.push(await scratch("checks-vendor-consumer-"));
    const { remote } = await seedRemote(parent, "1.0.0", "fake-lib@1.0.0");
    for (const consumer of consumers) await seedConsumer(consumer, remote, "1.0.0");
    const [first = ""] = consumers;
    expect((await vendor(first, home)).exitCode).toBe(0);
    const dir = cachedDir(home, remote, "1.0.0");

    await $`chmod -R u+w ${dir}`.quiet();
    const runs = await Promise.all(consumers.map((consumer) => vendor(consumer, home)));
    expect(runs.map((run) => run.exitCode)).toEqual([0, 0, 0, 0]);
    expect(runs.filter((run) => run.text.includes("froze")).length).toBeGreaterThan(0);
    expect(await writablePaths(dir)).toEqual([]);
    expect((await readdir(dirname(dir))).sort()).toEqual(["fake-lib@1.0.0", "fake-lib@1.0.0.commit"]);
  },
  60_000,
);

test(
  "a read-only file the library's own .gitignore hides fails the run and drops the link",
  async () => {
    const home = await scratchHome();
    const parent = await scratch("checks-vendor-remote-");
    const consumer = await scratch("checks-vendor-consumer-");
    const { remote } = await seedRemote(parent, "1.0.0", "fake-lib@1.0.0");
    await seedConsumer(consumer, remote, "1.0.0");
    expect((await vendor(consumer, home)).exitCode).toBe(0);

    const dir = cachedDir(home, remote, "1.0.0");
    const planted = join(dir, "node_modules", "pkg");
    await chmod(dir, 0o755);
    await mkdir(planted, { recursive: true });
    await writeFile(join(planted, "index.js"), "export {};\n");
    await $`chmod -R a-w ${join(dir, "node_modules")}`.quiet();
    await chmod(dir, 0o555);

    const run = await vendor(consumer, home);
    expect(run.exitCode).toBe(1);
    expect(run.text).toContain("outside the recorded commit");
    expect(await linked(consumer)).toBe(false);
  },
  60_000,
);

test(
  "a failed run drops the link to the tree it can no longer vouch for",
  async () => {
    const home = await scratchHome();
    const parent = await scratch("checks-vendor-remote-");
    const consumer = await scratch("checks-vendor-consumer-");
    const { remote } = await seedRemote(parent, "1.0.0", "fake-lib@1.0.0");
    await seedConsumer(consumer, remote, "1.0.0");
    expect((await vendor(consumer, home)).exitCode).toBe(0);

    await writeFile(join(consumer, "node_modules", "fake-lib", "package.json"), manifest("2.0.0"));
    const bumped = await vendor(consumer, home);
    expect(bumped.exitCode).toBe(1);
    expect(bumped.text).toContain("dropped repos/fake-lib");
    expect(await linked(consumer)).toBe(false);
  },
  60_000,
);

test(
  "a directory link inside the library leaves the modes outside the cache alone",
  async () => {
    const home = await scratchHome();
    const parent = await scratch("checks-vendor-remote-");
    const consumer = await scratch("checks-vendor-consumer-");
    const outside = await scratch("checks-vendor-outside-");
    await writeFile(join(outside, "kept.txt"), "writable\n");
    const seed = await seedRemote(parent, "1.0.0", "fake-lib@1.0.0");
    await symlink(outside, join(seed.work, "outside"));
    await moveTag(seed, "1.0.0", "fake-lib@1.0.0");
    await seedConsumer(consumer, seed.remote, "1.0.0");

    expect((await vendor(consumer, home)).exitCode).toBe(0);
    expect((await stat(join(outside, "kept.txt"))).mode & 0o200).toBe(0o200);
    expect((await stat(outside)).mode & 0o200).toBe(0o200);
    expect((await vendor(consumer, home)).exitCode).toBe(0);
  },
  60_000,
);

test(
  "a copied tree with no .git warns once, links nothing and passes",
  async () => {
    const home = await scratchHome();
    const parent = await scratch("checks-vendor-remote-");
    const consumer = await scratch("checks-vendor-consumer-");
    const { remote } = await seedRemote(parent, "1.0.0", "fake-lib@1.0.0");
    await seedConsumer(consumer, remote, "1.0.0");
    await rm(join(consumer, ".git"), { recursive: true, force: true });

    const copied = await vendor(consumer, home);
    expect(copied.exitCode).toBe(0);
    expect(copied.text.match(/checks-vendor:/g)).toHaveLength(1);
    expect(copied.text).toContain("no checkout holds repos/");
    expect(await linked(consumer)).toBe(false);
    expect(await readdir(consumer)).not.toContain("repos");
  },
  60_000,
);

test(
  "bad arguments fail before a fetch, and no arguments pin nothing",
  async () => {
    const home = await scratchHome();
    const consumer = await scratch("checks-vendor-consumer-");
    await seedConsumer(consumer, "https://example.com/fake-lib.git", "1.0.0");
    const library = libraryArgs("https://example.com/fake-lib.git");

    const repeated = await vendorWith(consumer, home, [...library, ...library]);
    expect(repeated.exitCode).toBe(2);
    expect(repeated.text).toContain("--library fake-lib appears more than once");

    for (const [args, message] of [
      [["--package", "fake-lib"], "--package comes before any --library"],
      [[...library, "--tag"], "--tag takes a value"],
      [[...library, "--branch", "main"], "--branch is not an argument"],
      [[...library, "--tag", "v2"], "--tag appears twice for --library fake-lib"],
      [["--library", "fake-lib", "--package", "fake-lib", "--tag", TEMPLATE], "repository"],
      [[...library.slice(0, -1), "fake-lib@1.0.0"], "version"],
    ] as const) {
      const bad = await vendorWith(consumer, home, args);
      expect(bad.exitCode).toBe(2);
      expect(bad.text).toContain(message);
      expect(bad.text).toContain("usage: checks-vendor");
    }
    expect(await readdir(home)).not.toContain(".cache");

    const none = await vendorWith(consumer, home, []);
    expect(none.exitCode).toBe(0);
    expect(none.text).toContain("no --library argument names a library, so nothing is pinned");
    expect(await linked(consumer)).toBe(false);
  },
  60_000,
);
