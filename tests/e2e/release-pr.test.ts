import { $ } from "bun";
import { expect, test } from "bun:test";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fakeGh, type FakeGh } from "./lib/fake-gh.ts";
import { CHECKOUT, fixtureRepos, ran, type Ran, scratchDirs } from "./lib/fixture-repo.ts";

const SCRIPT = join(CHECKOUT, "src", "delivery", "release-pr.ts");
const CHANGELOG = join(CHECKOUT, "src", "delivery", "changelog-write.ts");

const repository = fixtureRepos("checks-release-pr-");
const scratch = scratchDirs();

type Consumer = {
  readonly dir: string;
  readonly run: (args: readonly string[], env?: Readonly<Record<string, string>>) => Promise<Ran>;
  readonly commit: (message: string) => Promise<string>;
  readonly state: FakeGh["state"];
  readonly land: (message: string) => Promise<string>;
  readonly inOrigin: (...args: readonly string[]) => Promise<string>;
};

function manifest(version: string): string {
  const scripts = { build: `bun ${CHANGELOG}` };
  return `${JSON.stringify({ name: "widget", version, repository: { type: "git", url: "git+https://github.com/acme/widget.git" }, scripts }, null, 2)}\n`;
}

// A consumer released at v0.1.0, with one fix on main since, whose origin is a bare repository the fake gh writes into.
async function consumer(): Promise<Consumer> {
  const repo = await repository({ "package.json": manifest("0.1.0") });
  const { dir } = repo;
  let changes = 0;
  const commit = async (message: string): Promise<string> => {
    changes += 1;
    await repo.write({ [`notes/${changes}.txt`]: `${message}\n` });
    return repo.commit(message);
  };
  await commit("feat: build a bill (#1)");
  await $`bun ${CHANGELOG}`.cwd(dir).quiet();
  await commit("docs: write the changelog (#2)");
  await $`git tag v0.1.0`.cwd(dir).quiet();
  await commit("fix(parts): keep the order of parts (#3)");
  const home = await scratch("checks-release-pr-home-");
  const origin = join(home, "origin.git");
  await $`git init -q --bare -b main ${origin} && git remote add origin ${origin} && git push -q origin main --tags`.cwd(dir).quiet();
  const fake = await fakeGh(home, origin);
  return {
    dir,
    run: (args, env = {}) => ran($`bun ${SCRIPT} ${args}`.cwd(dir).env({ ...process.env, ...fake.env, ...env })),
    commit,
    state: fake.state,
    land: async (message) => {
      const sha = await commit(message);
      await $`git push -q origin main`.cwd(dir).quiet();
      return sha;
    },
    inOrigin: async (...args) => (await $`git ${args}`.cwd(origin).quiet()).stdout.toString().trim(),
  };
}

async function head(dir: string): Promise<string> {
  return (await $`git rev-parse HEAD`.cwd(dir).quiet()).stdout.toString().trim();
}

test(
  "a fix since the last tag opens one pull request that bumps the patch, carries the built changelog and dispatches the checks on its head",
  async () => {
    const widget = await consumer();
    const main = await head(widget.dir);

    const opened = await widget.run(["ci.yml", "commitlint.yml"]);
    expect(opened.text).toContain(
      "release-pr: opened https://github.com/acme/widget/pull/1 to release 0.1.1, and dispatched ci.yml, commitlint.yml on release/main\n",
    );
    expect(opened.exitCode).toBe(0);

    expect(await widget.inOrigin("log", "-1", "--format=%s%n%P%n%an <%ae>", "release/main")).toBe(
      `chore: release 0.1.1\n${main}\ngithub-actions[bot] <41898282+github-actions[bot]@users.noreply.github.com>`,
    );
    expect(await widget.inOrigin("diff", "--name-only", "main", "release/main")).toBe("CHANGELOG.md\npackage.json");
    expect(await widget.inOrigin("show", "release/main:package.json")).toBe(manifest("0.1.1").trim());
    const changelog = await widget.inOrigin("show", "release/main:CHANGELOG.md");
    expect(changelog).toContain("## 0.1.1");
    expect(changelog).toContain("- **parts:** keep the order of parts [#3](https://github.com/acme/widget/pull/3)");

    const state = await widget.state();
    expect(state.pulls).toEqual([
      { number: 1, title: "chore: release 0.1.1", head: "release/main", base: "main", body: "Release 0.1.1.", html_url: "https://github.com/acme/widget/pull/1" },
    ]);
    expect(state.dispatches).toEqual([
      { workflow: "ci.yml", ref: "release/main" },
      { workflow: "commitlint.yml", ref: "release/main" },
    ]);
    expect((await $`git status --porcelain`.cwd(widget.dir).quiet()).stdout.toString()).toBe("");
    expect(await readFile(join(widget.dir, "package.json"), "utf8")).toBe(manifest("0.1.0"));
  },
  60_000,
);

test(
  "a second run on the same main leaves the release pull request alone and dispatches nothing",
  async () => {
    const widget = await consumer();
    expect((await widget.run(["ci.yml"])).exitCode).toBe(0);
    const before = await widget.state();

    const again = await widget.run(["ci.yml"]);
    expect(again.text).toContain(`release-pr: https://github.com/acme/widget/pull/1 releases 0.1.1 from ${(await head(widget.dir)).slice(0, 12)} and is current\n`);
    expect(again.exitCode).toBe(0);
    const after = await widget.state();
    expect(after.calls.slice(before.calls.length)).toEqual(["GET repos/{owner}/{repo}/pulls?head={owner}:release%2Fmain&base=main&state=open"]);
    expect(after.dispatches).toEqual(before.dispatches);
  },
  60_000,
);

test(
  "a feature landing on main rebuilds the branch on it and retitles the same pull request to the minor version",
  async () => {
    const widget = await consumer();
    expect((await widget.run(["ci.yml"])).exitCode).toBe(0);
    const landed = await widget.land("feat: price a bill (#4)");

    const refreshed = await widget.run(["ci.yml"]);
    expect(refreshed.text).toContain("release-pr: refreshed https://github.com/acme/widget/pull/1 to release 0.2.0, and dispatched ci.yml on release/main\n");
    expect(refreshed.exitCode).toBe(0);
    expect(await widget.inOrigin("log", "-1", "--format=%s %P", "release/main")).toBe(`chore: release 0.2.0 ${landed}`);
    const state = await widget.state();
    expect(state.pulls.map(({ title, body }) => ({ title, body }))).toEqual([{ title: "chore: release 0.2.0", body: "Release 0.2.0." }]);
    expect(state.calls).toContain("PATCH repos/{owner}/{repo}/git/refs/heads/release/main");
    expect(state.dispatches).toEqual([
      { workflow: "ci.yml", ref: "release/main" },
      { workflow: "ci.yml", ref: "release/main" },
    ]);
  },
  60_000,
);

test(
  "a refused pull request dispatches nothing, and the next run opens it on the branch already built",
  async () => {
    const widget = await consumer();
    const refused = await widget.run(["ci.yml"], { FAKE_GH_FAIL: "POST repos/{owner}/{repo}/pulls" });
    expect(refused.exitCode).toBe(2);
    expect(refused.text).toContain("checks-release-pr: gh api POST repos/{owner}/{repo}/pulls: gh: Resource not accessible by integration (HTTP 403)");
    expect((await widget.state()).dispatches).toEqual([]);
    expect(await widget.inOrigin("log", "-1", "--format=%s", "release/main")).toBe("chore: release 0.1.1");
    const before = await widget.state();

    const retried = await widget.run(["ci.yml"]);
    expect(retried.text).toContain("release-pr: opened https://github.com/acme/widget/pull/1 to release 0.1.1, and dispatched ci.yml on release/main\n");
    expect(retried.exitCode).toBe(0);
    const after = await widget.state();
    expect(after.calls.slice(before.calls.length)).toEqual([
      "GET repos/{owner}/{repo}/pulls?head={owner}:release%2Fmain&base=main&state=open",
      "POST repos/{owner}/{repo}/pulls",
      "POST repos/{owner}/{repo}/actions/workflows/ci.yml/dispatches",
    ]);
  },
  60_000,
);

test(
  "with nothing unreleased since the last tag it opens nothing",
  async () => {
    const widget = await consumer();
    await writeFile(join(widget.dir, "package.json"), manifest("0.1.1"));
    await widget.commit("chore: release 0.1.1 (#5)");
    await $`git tag v0.1.1`.cwd(widget.dir).quiet();

    expect(await widget.run(["ci.yml"])).toEqual({ exitCode: 0, text: "release-pr: no unreleased changes since v0.1.1\n" });
    expect((await widget.state()).calls).toEqual([]);
  },
  60_000,
);

test(
  "a version the last tag does not name, a dirty tree, a detached head and no workflow are each refused before anything is written",
  async () => {
    const widget = await consumer();
    await writeFile(join(widget.dir, "package.json"), manifest("0.3.0"));
    await widget.commit("chore: jump");
    const untagged = await widget.run(["ci.yml"]);
    expect(untagged.exitCode).toBe(2);
    expect(untagged.text).toContain("checks-release-pr: package.json holds 0.3.0, but the last release tag is v0.1.0; tag the release package.json names, or return its version to 0.1.0");

    await $`git reset -q --hard HEAD~1`.cwd(widget.dir).quiet();
    await writeFile(join(widget.dir, "CHANGELOG.md"), "edited by hand\n");
    const dirty = await widget.run(["ci.yml"]);
    expect(dirty.exitCode).toBe(2);
    expect(dirty.text).toContain("checks-release-pr: the working tree has changes to tracked files; the release commits only what the build writes");

    await $`git checkout -q -- CHANGELOG.md && git checkout -q --detach`.cwd(widget.dir).quiet();
    const detached = await widget.run(["ci.yml"]);
    expect(detached.exitCode).toBe(2);
    expect(detached.text).toContain("checks-release-pr: HEAD is detached; check out the branch the release goes to");

    const usage = await widget.run([]);
    expect(usage.exitCode).toBe(2);
    expect(usage.text).toContain("usage: release-pr.ts <workflow>...");

    expect((await widget.state()).calls.filter((call) => !call.startsWith("GET "))).toEqual([]);
    expect(await widget.inOrigin("for-each-ref", "--format=%(refname)", "refs/heads/release/")).toBe("");
  },
  60_000,
);
