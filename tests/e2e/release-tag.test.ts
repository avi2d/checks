import { $ } from "bun";
import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fakeGh, type FakeGh } from "./lib/fake-gh.ts";
import { CHECKOUT, type FixtureRepo, fixtureRepos, ran, type Ran, scratchDirs } from "./lib/fixture-repo.ts";

const SCRIPT = join(CHECKOUT, "src", "delivery", "release-tag.ts");
const CHANGELOG = join(CHECKOUT, "src", "delivery", "changelog-write.ts");

const repository = fixtureRepos("checks-release-tag-");
const scratch = scratchDirs();

type Landed = {
  readonly head: string;
  readonly run: (args: readonly string[], env?: Readonly<Record<string, string>>) => Promise<Ran>;
  readonly state: FakeGh["state"];
  readonly inOrigin: (...args: readonly string[]) => Promise<string>;
};

function manifest(version: string): string {
  const scripts = { build: `bun ${CHANGELOG}` };
  return `${JSON.stringify({ name: "widget", version, repository: { type: "git", url: "git+https://github.com/acme/widget.git" }, scripts }, null, 2)}\n`;
}

// A bare origin the tag is pushed to, holding main as the repository has it.
async function withOrigin(repo: FixtureRepo, head: string): Promise<Landed> {
  const home = await scratch("checks-release-tag-home-");
  const origin = join(home, "origin.git");
  await $`git init -q --bare -b main ${origin} && git remote add origin ${origin} && git push -q origin main`.cwd(repo.dir).quiet();
  const fake = await fakeGh(home, origin);
  return {
    head,
    run: (args, env = {}) => ran($`bun ${SCRIPT} ${args}`.cwd(repo.dir).env({ ...process.env, ...fake.env, ...env })),
    state: fake.state,
    inOrigin: async (...args) => (await $`git ${args}`.cwd(origin).quiet()).stdout.toString().trim(),
  };
}

// main as a squash merge lands a commit on it, carrying the changelog the build writes.
async function landed(version: string, subject: string): Promise<Landed> {
  const repo = await repository({ "package.json": manifest(version) });
  await repo.commit("chore: add the manifest");
  await $`bun ${CHANGELOG}`.cwd(repo.dir).quiet();
  return withOrigin(repo, await repo.commit(subject));
}

test(
  "a landed release commit is tagged with its version once, and the release workflow is dispatched on the tag",
  async () => {
    const main = await landed("0.2.0", "chore: release 0.2.0 (#7)");

    const tagged = await main.run(["release.yml"]);
    expect(tagged.exitCode).toBe(0);
    expect(tagged.text).toContain(`release-tag: tagged ${main.head.slice(0, 12)} as v0.2.0, and dispatched release.yml on it\n`);
    expect(await main.inOrigin("rev-parse", "v0.2.0^{commit}")).toBe(main.head);
    expect((await main.state()).dispatches).toEqual([{ workflow: "release.yml", ref: "v0.2.0" }]);

    const again = await main.run(["release.yml"]);
    expect(again).toEqual({ exitCode: 0, text: `release-tag: v0.2.0 already tags ${main.head.slice(0, 12)}\n` });
    expect((await main.state()).dispatches).toHaveLength(1);
  },
  60_000,
);

test(
  "a failed dispatch after the tag is pushed names the command that dispatches the release by hand, since a rerun finds the tag and does nothing",
  async () => {
    const main = await landed("0.2.0", "chore: release 0.2.0 (#7)");

    const failed = await main.run(["release.yml"], { FAKE_GH_FAIL: "POST repos/{owner}/{repo}/actions/workflows/release.yml/dispatches" });
    expect(failed.exitCode).toBe(2);
    expect(failed.text).toContain("gh: Resource not accessible by integration (HTTP 403)");
    expect(failed.text).toContain("v0.2.0 is pushed, so dispatch the release by hand with `gh workflow run release.yml --ref v0.2.0`");
    expect(await main.inOrigin("rev-parse", "v0.2.0^{commit}")).toBe(main.head);

    const again = await main.run(["release.yml"]);
    expect(again).toEqual({ exitCode: 0, text: `release-tag: v0.2.0 already tags ${main.head.slice(0, 12)}\n` });
    expect((await main.state()).dispatches).toEqual([]);
  },
  60_000,
);

test(
  "a release that merged behind main is refused before it is tagged, and returning its version cancels it so the next release holds every change since the last tag",
  async () => {
    const repo = await repository({ "package.json": manifest("0.1.0") });
    const land = async (subject: string, files: Readonly<Record<string, string>>): Promise<string> => {
      await repo.write(files);
      return repo.commit(subject);
    };
    await land("feat: build a bill (#1)", { "notes/1.txt": "bill\n" });
    await $`bun ${CHANGELOG}`.cwd(repo.dir).quiet();
    await land("docs: write the changelog (#2)", {});
    await $`git tag v0.1.0`.cwd(repo.dir).quiet();
    await land("feat: price a bill (#3)", { "notes/3.txt": "price\n" });
    await repo.write({ "package.json": manifest("0.2.0") });
    await $`bun ${CHANGELOG}`.cwd(repo.dir).quiet();
    const builtBeforeTheFix = await readFile(join(repo.dir, "CHANGELOG.md"), "utf8");
    await $`git checkout -q -- .`.cwd(repo.dir).quiet();
    await land("fix(parts): keep the order of parts (#4)", { "notes/4.txt": "order\n" });
    const main = await withOrigin(repo, await land("chore: release 0.2.0 (#5)", { "package.json": manifest("0.2.0"), "CHANGELOG.md": builtBeforeTheFix }));

    const refused = await main.run(["release.yml"]);
    expect(refused.exitCode).toBe(2);
    expect(refused.text).toContain(
      `checks-release-tag: the build rewrites CHANGELOG.md at ${main.head.slice(0, 12)}, which the release workflow's build check refuses; open a \`chore: cancel the unpublished 0.2.0\` pull request that returns package.json to 0.1.0 and commits what \`bun run build\` then writes to CHANGELOG.md, and the next daily-release run cuts the release again with every change since v0.1.0`,
    );
    expect(await main.inOrigin("tag", "--list")).toBe("");
    expect((await main.state()).calls).toEqual([]);

    await land("fix(parts): keep the parts after a refund (#6)", { "notes/6.txt": "refund\n" });
    await repo.write({ "package.json": manifest("0.1.0") });
    await $`bun ${CHANGELOG}`.cwd(repo.dir).quiet();
    await land("chore: cancel the unpublished 0.2.0 (#7)", {});
    expect(await readFile(join(repo.dir, "CHANGELOG.md"), "utf8")).not.toContain("## 0.2.0");
    await $`bun ${CHANGELOG}`.cwd(repo.dir).quiet();
    expect((await $`git status --porcelain`.cwd(repo.dir).quiet()).stdout.toString()).toBe("");

    const pending = await repo.script("delivery/release-report.ts");
    expect(pending).toEqual({
      exitCode: 1,
      text: [
        "release-report: 3 unreleased change(s) since v0.1.0:",
        "  fix(parts): keep the parts after a refund (#6)",
        "  fix(parts): keep the order of parts (#4)",
        "  feat: price a bill (#3)",
        "",
      ].join("\n"),
    });

    await repo.write({ "package.json": manifest("0.2.0") });
    await $`bun ${CHANGELOG}`.cwd(repo.dir).quiet();
    const recut = await readFile(join(repo.dir, "CHANGELOG.md"), "utf8");
    const recutSection = recut.slice(recut.indexOf("## 0.2.0"), recut.indexOf("## 0.1.0"));
    for (const pull of ["#3", "#4", "#6"]) expect(recutSection).toContain(`[${pull}]`);
  },
  60_000,
);

test(
  "a commit that releases nothing is left untagged",
  async () => {
    const main = await landed("0.2.0", "feat: price a bill (#4)");

    expect(await main.run(["release.yml"])).toEqual({ exitCode: 0, text: `release-tag: ${main.head.slice(0, 12)} is no release commit\n` });
    expect(await main.inOrigin("tag", "--list")).toBe("");
    expect((await main.state()).calls).toEqual([]);
  },
  60_000,
);

test(
  "a release commit whose package.json disagrees, or whose tag already sits elsewhere, is refused and dispatches nothing",
  async () => {
    const disagreeing = await landed("0.2.0", "chore: release 0.3.0 (#8)");
    const refused = await disagreeing.run(["release.yml"]);
    expect(refused.exitCode).toBe(2);
    expect(refused.text).toContain(`checks-release-tag: ${disagreeing.head.slice(0, 12)} releases 0.3.0, but package.json holds 0.2.0`);

    const moved = await landed("0.2.0", "chore: release 0.2.0 (#7)");
    const elsewhere = await moved.inOrigin("-c", "user.name=Wren Fixture", "-c", "user.email=wren@example.com", "commit-tree", `${moved.head}^{tree}`, "-m", "elsewhere");
    await moved.inOrigin("tag", "v0.2.0", elsewhere);
    const clash = await moved.run(["release.yml"]);
    expect(clash.exitCode).toBe(2);
    expect(clash.text).toContain(`checks-release-tag: v0.2.0 already tags ${elsewhere.slice(0, 12)}, not ${moved.head.slice(0, 12)}`);

    for (const run of [disagreeing, moved]) expect((await run.state()).dispatches).toEqual([]);
    expect((await moved.run([])).text).toContain("usage: release-tag.ts <workflow>");
  },
  60_000,
);
