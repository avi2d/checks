import { $ } from "bun";
import { expect, test } from "bun:test";
import { join } from "node:path";
import { fakeGh, type FakeGh } from "../lib/fake-gh.ts";
import { CHECKOUT, type FixtureRepo, fixtureRepos, ran, type Ran, scratchDirs } from "../lib/fixture-repo.ts";

const SCRIPT = join(CHECKOUT, "scripts", "tested-tree.ts");
const TAG = join(CHECKOUT, "src", "delivery", "release-tag.ts");
const CHANGELOG = join(CHECKOUT, "src", "delivery", "changelog-write.ts");

const repository = fixtureRepos("checks-tested-tree-");
const scratch = scratchDirs();

function manifest(version: string): string {
  const scripts = { build: `bun ${CHANGELOG}` };
  return `${JSON.stringify({ name: "widget", version, repository: { type: "git", url: "git+https://github.com/acme/widget.git" }, scripts }, null, 2)}\n`;
}

type Released = {
  readonly run: (script: string, args?: readonly string[]) => Promise<Ran>;
  readonly rev: (revision: string) => Promise<string>;
  readonly isAncestor: (older: string, newer: string) => Promise<boolean>;
  readonly state: FakeGh["state"];
  readonly inOrigin: (...args: readonly string[]) => Promise<string>;
  readonly pr: string;
  readonly landed: string;
};

// The release pull request head as the origin keeps it after the squash merge deletes the branch:
// a pull ref, not a branch, and never an ancestor of the landed commit.
async function released(refactors: readonly string[] = []): Promise<Released> {
  const repo: FixtureRepo = await repository({ "package.json": manifest("0.1.0") });
  await repo.commit("chore: add the manifest");
  await repo.write({ "notes/1.txt": "one\n" });
  await repo.commit("feat: build a bill (#1)");
  await $`bun ${CHANGELOG}`.cwd(repo.dir).quiet();
  await repo.write({ "notes/2.txt": "two\n" });
  await repo.commit("docs: price a bill (#2)");
  await $`git tag v0.1.0`.cwd(repo.dir).quiet();
  await repo.write({ "notes/3.txt": "three\n" });
  await repo.commit("fix: paint a bill (#3)");
  const home = await scratch("checks-tested-tree-home-");
  const origin = join(home, "origin.git");
  await $`git init -q --bare -b main ${origin} && git remote add origin ${origin} && git push -q origin main`.cwd(repo.dir).quiet();

  await $`git checkout -qb release/0.1.1`.cwd(repo.dir).quiet();
  await repo.write({ "package.json": manifest("0.1.1") });
  await $`bun ${CHANGELOG}`.cwd(repo.dir).quiet();
  const pr = await repo.commit("chore: release 0.1.1");
  await $`git push -q origin release/0.1.1`.cwd(repo.dir).quiet();
  await $`git update-ref refs/pull/1/head ${pr}`.cwd(origin).quiet();
  await $`git push -q origin :release/0.1.1 && git checkout -q main && git branch -qD release/0.1.1`.cwd(repo.dir).quiet();

  for (const [index, subject] of refactors.entries()) {
    await repo.write({ [`notes/refactor-${index}.txt`]: "refactor\n" });
    await repo.commit(subject);
  }
  await $`git merge -q --squash ${pr}`.cwd(repo.dir).quiet();
  const landed = await repo.commit("chore: release 0.1.1 (#1)");
  const fake = await fakeGh(home, origin);
  const run = (script: string, args: readonly string[] = []) =>
    ran($`bun ${script} ${args}`.cwd(repo.dir).env({ ...process.env, ...fake.env }));
  return {
    run,
    rev: async (revision) => (await $`git rev-parse ${revision}`.cwd(repo.dir).quiet()).stdout.toString().trim(),
    isAncestor: async (older, newer) =>
      (await $`git merge-base --is-ancestor ${older} ${newer}`.cwd(repo.dir).nothrow().quiet()).exitCode === 0,
    state: fake.state,
    inOrigin: async (...args) => (await $`git ${args}`.cwd(origin).quiet()).stdout.toString().trim(),
    pr,
    landed,
  };
}

test(
  "a release squash-merged up to date matches the pull request tree, and the release tags",
  async () => {
    const main = await released();

    const checked = await main.run(SCRIPT);
    expect(checked.exitCode).toBe(0);
    expect(checked.text).toContain(`tested-tree: ${main.landed.slice(0, 12)} matches the tree pull request #1 tested`);
    expect(await main.isAncestor(main.pr, main.landed)).toBe(false);

    const tagged = await main.run(TAG, ["release.yml"]);
    expect(tagged.exitCode).toBe(0);
    expect(tagged.text).toContain(`release-tag: tagged ${main.landed.slice(0, 12)} as v0.1.1`);
  },
  60_000,
);

test(
  "a release squash-merged behind main is refused before it is tagged",
  async () => {
    const main = await released(["refactor: repaint a bill"]);
    const tested = await main.rev(`${main.pr}^{tree}`);

    const refused = await main.run(SCRIPT);
    expect(refused.exitCode).toBe(2);
    expect(refused.text).toContain(
      `tested-tree: ${main.landed.slice(0, 12)} differs from the ${tested.slice(0, 12)} tree pull request #1 tested`,
    );
    expect(await main.isAncestor(main.pr, main.landed)).toBe(false);
    expect(await main.inOrigin("tag", "-l", "v0.1.1")).toBe("");
    expect((await main.state()).dispatches).toEqual([]);
  },
  60_000,
);

test(
  "a commit that releases nothing passes the tree check through",
  async () => {
    const repo: FixtureRepo = await repository({ "package.json": manifest("0.1.0") });
    const head = await repo.commit("fix: paint a bill (#3)");

    const checked = await ran($`bun ${SCRIPT}`.cwd(repo.dir).env(process.env));
    expect(checked.exitCode).toBe(0);
    expect(checked.text).toContain(`tested-tree: ${head.slice(0, 12)} is no release commit`);
  },
  60_000,
);
