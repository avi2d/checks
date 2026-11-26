import { $ } from "bun";
import { expect, test } from "bun:test";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fakeGh, type FakeGh } from "../lib/fake-gh.ts";
import { releasedMains } from "../lib/released-main.ts";
import { CHECKOUT, type FixtureRepo, fixtureRepos, ran, type Ran, scratchDirs } from "../lib/fixture-repo.ts";

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

test("a release without CHANGELOG.md cannot create a tag", async () => {
  const repo = await repository({ "package.json": manifest("0.2.0") });
  const main = await withOrigin(repo, await repo.commit("chore: release 0.2.0 (#7)"));
  for (const args of [[], ["release.yml"]]) {
    const result = await main.run(args);
    expect(result.exitCode).toBe(2);
    expect(result.text).toContain("CHANGELOG.md");
    expect(await main.inOrigin("tag", "--list")).toBe("");
  }
}, 30_000);

test("an existing release tag without CHANGELOG.md does not refuse or dispatch again", async () => {
  const repo = await repository({ "package.json": manifest("0.2.0") });
  const main = await withOrigin(repo, await repo.commit("chore: release 0.2.0 (#7)"));
  await main.inOrigin("tag", "v0.2.0", main.head);

  const again = await main.run(["release.yml"]);
  expect(again).toEqual({ exitCode: 0, text: `release-tag: v0.2.0 already tags ${main.head.slice(0, 12)}\n` });
  expect(await main.inOrigin("rev-parse", "v0.2.0^{commit}")).toBe(main.head);
  expect((await main.state()).dispatches).toEqual([]);
}, 30_000);

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

    const refused = await main.run(["release.yml"], { GITHUB_WORKFLOW: "release-pr" });
    expect(refused.exitCode).toBe(2);
    expect(refused.text).toContain(
      `checks-release-tag: the build rewrites CHANGELOG.md at ${main.head.slice(0, 12)}, which the release workflow's build check refuses; open a \`chore: cancel the unpublished 0.2.0\` pull request that returns package.json to 0.1.0 and commits what \`bun run build\` then writes to CHANGELOG.md, and the next release-pr run cuts the release again with every change since v0.1.0`,
    );
    expect(await main.inOrigin("tag", "--list")).toBe("");
    expect((await main.state()).calls).toEqual(["GET repos/{owner}/{repo}/git/ref/tags/v0.2.0"]);

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
    expect((await moved.run(["release.yml", "ci.yml"])).text).toContain("usage: release-tag.ts [<workflow>]");
  },
  60_000,
);

const onMain = releasedMains("checks-release-tag-main-");

test(
  "with no argument a release commit on main is tagged, released on GitHub with its changelog notes and published, and a rerun does each at most once",
  async () => {
    const main = await onMain("chore: release 0.2.0 (#7)");

    const released = await main.run(SCRIPT, []);
    expect(released.exitCode).toBe(0);
    expect(released.text).toContain(`release-tag: ${main.head.slice(0, 12)} matches the tree pull request #7 tested\n`);
    expect(released.text).toContain(`release-tag: tagged ${main.head.slice(0, 12)} as v0.2.0\n`);
    expect(released.text).toContain("release-tag: created the GitHub release v0.2.0 with the CHANGELOG.md section for 0.2.0\n");
    expect(released.text).toContain("release-publish: published widget@0.2.0\n");
    expect(await main.inOrigin("rev-parse", "v0.2.0^{commit}")).toBe(main.head);
    const [release, ...others] = (await main.state()).releases;
    expect(others).toEqual([]);
    expect(release?.tag_name).toBe("v0.2.0");
    expect(release?.body).toContain("price a bill");
    expect(main.changelog).toContain(release?.body ?? "no body");
    expect((await main.state()).dispatches).toEqual([]);
    expect((await main.npm()).latest).toBe("0.2.0");

    const again = await main.run(SCRIPT, []);
    expect(again.exitCode).toBe(0);
    expect(again.text).toContain(`release-tag: v0.2.0 already tags ${main.head.slice(0, 12)}\n`);
    expect(again.text).toContain("release-tag: rewrote the notes of the GitHub release v0.2.0\n");
    expect(again.text).toContain("release-publish: npm already holds widget@0.2.0\n");
    expect((await main.state()).releases).toHaveLength(1);
    expect((await main.npm()).calls.filter((call) => call === "publish")).toHaveLength(1);
  },
  60_000,
);

test(
  "with no argument a release run writes tag=v<version> to GITHUB_OUTPUT and a merge that releases nothing writes no tag, so the assets job never skips after a release nor runs without one",
  async () => {
    const release = await onMain("chore: release 0.2.0 (#7)");
    expect((await release.run(SCRIPT, [])).exitCode).toBe(0);
    expect(await release.output()).toBe("tag=v0.2.0\n");

    const plain = await onMain("feat: price a bill (#8)");
    expect((await plain.run(SCRIPT, [])).exitCode).toBe(0);
    expect(await plain.output()).toBe("");
  },
  60_000,
);

test(
  "with no argument a merge that releases nothing ends at once, calling neither GitHub nor npm",
  async () => {
    const main = await onMain("feat: price a bill (#8)");

    expect(await main.run(SCRIPT, [])).toEqual({ exitCode: 0, text: `release-tag: ${main.head.slice(0, 12)} is no release commit; a release whose GitHub release or npm publish failed is finished by rerunning that release commit's own main run\n` });
    expect(await main.inOrigin("tag", "--list")).toBe("");
    expect((await main.state()).calls).toEqual([]);
    expect((await main.npm()).calls).toEqual([]);
  },
  60_000,
);

test(
  "with no argument a plain commit after a release commit releases the release commit behind it, publishing its tree",
  async () => {
    const main = await onMain("chore: release 0.2.0 (#7)");
    const behind = main.head;
    await writeFile(join(main.dir, "notes/3.txt"), "tampered\n");
    await $`git add notes/3.txt && git commit -q -m ${"docs: fix a typo (#8)"}`.cwd(main.dir).quiet();
    await $`rm -rf node_modules`.cwd(main.dir).quiet();

    const released = await main.run(SCRIPT, []);
    expect(released.exitCode).toBe(0);
    expect(released.text).toContain(`${behind.slice(0, 12)} matches the tree pull request #7 tested`);
    expect(released.text).toContain(`release-tag: tagged ${behind.slice(0, 12)} as v0.2.0`);
    expect(await main.inOrigin("rev-parse", "v0.2.0^{commit}")).toBe(behind);
    expect((await main.state()).releases.map(({ tag_name: tag }) => tag)).toEqual(["v0.2.0"]);
    expect((await main.npm()).latest).toBe("0.2.0");
    expect((await main.npm()).published).toEqual([behind]);
  },
  60_000,
);

test(
  "with platformPackages a plain commit after a release commit, whose run built no binaries, is refused before any tag, GitHub release or npm publish, instead of tagging a release whose platform packages never reach npm",
  async () => {
    const main = await onMain("chore: release 0.2.0 (#7)", { platformPackages: true });
    const behind = main.head;
    await $`git commit -q --allow-empty -m ${"docs: fix a typo (#8)"}`.cwd(main.dir).quiet();
    const binaries = await scratch("checks-release-tag-binaries-");

    const refused = await ran($`bun ${SCRIPT}`.cwd(main.dir).env({ ...process.env, ...main.env, CHECKS_PLATFORM_BINARIES: binaries }));
    expect(refused.exitCode).toBe(2);
    expect(refused.text).toContain(
      `${join(binaries, "widget-linux-x64")} is missing, so the widget-linux-x64 package has no binary to hold; this run tags and publishes nothing, so rerun the main run of the release commit ${behind.slice(0, 12)}, whose binaries job builds every platform`,
    );
    expect(await main.inOrigin("tag", "--list")).toBe("");
    expect((await main.state()).releases).toEqual([]);
    expect((await main.npm()).calls).toEqual([]);
  },
  60_000,
);

test(
  "with no argument a cancelled release behind later commits releases nothing",
  async () => {
    const main = await onMain("chore: release 0.2.0 (#7)");
    await writeFile(join(main.dir, "package.json"), manifest("0.1.0"));
    await $`git add package.json && git commit -q -m ${"chore: cancel the unpublished 0.2.0 (#8)"}`.cwd(main.dir).quiet();
    await $`git commit -q --allow-empty -m ${"docs: fix a typo (#9)"}`.cwd(main.dir).quiet();
    const plain = (await $`git rev-parse HEAD`.cwd(main.dir).quiet()).stdout.toString().trim();

    expect(await main.run(SCRIPT, [])).toEqual({ exitCode: 0, text: `release-tag: ${plain.slice(0, 12)} is no release commit; a release whose GitHub release or npm publish failed is finished by rerunning that release commit's own main run\n` });
    expect(await main.inOrigin("tag", "--list")).toBe("");
    expect((await main.state()).releases).toEqual([]);
    expect((await main.npm()).calls).toEqual([]);
  },
  60_000,
);

test(
  "with no argument a release commit whose tag is already pushed but which has no GitHub release yet still creates the release and publishes",
  async () => {
    const main = await onMain("chore: release 0.2.0 (#7)");
    await $`git push -q origin HEAD:refs/tags/v0.2.0`.cwd(main.dir).quiet();

    const released = await main.run(SCRIPT, []);
    expect(released.exitCode).toBe(0);
    expect(released.text).toContain(`release-tag: v0.2.0 already tags ${main.head.slice(0, 12)}\n`);
    expect(released.text).toContain("release-tag: created the GitHub release v0.2.0 with the CHANGELOG.md section for 0.2.0\n");
    expect(released.text).toContain("release-publish: published widget@0.2.0\n");
    expect((await main.state()).releases.map(({ tag_name: tag }) => tag)).toEqual(["v0.2.0"]);
    expect((await main.npm()).latest).toBe("0.2.0");
  },
  60_000,
);

test(
  "a rerun with the tag at head builds before npm rejects a publish without built files",
  async () => {
    const main = await onMain("chore: release 0.2.0 (#7)");
    await $`git push -q origin HEAD:refs/tags/v0.2.0`.cwd(main.dir).quiet();
    const build = join(main.dir, "scripts/build.ts");
    await writeFile(build, `${await readFile(build, "utf8")}\nawait Bun.write("built-output", "built");\n`);
    const npm = join((main.env["PATH"] ?? "").split(":")[0] ?? "", "npm");
    await rename(npm, `${npm}-real`);
    await writeFile(npm, `#!/bin/sh\nif [ "$1" = publish ] && [ ! -f built-output ]; then exit 1; fi\nexec "${npm}-real" "$@"\n`, { mode: 0o755 });

    const released = await main.run(SCRIPT, []);
    expect(released.exitCode).toBe(0);
    expect(await readFile(join(main.dir, "built-output"), "utf8")).toBe("built");
    expect((await main.npm()).published).toEqual([main.head]);
  },
  60_000,
);

test(
  "with no argument a private package is tagged and released on GitHub but never published to npm",
  async () => {
    const main = await onMain("chore: release 0.2.0 (#7)", { private: true });

    const released = await main.run(SCRIPT, []);
    expect(released.exitCode).toBe(0);
    expect(released.text).toContain("release-tag: package.json is private, so no package is published\n");
    expect((await main.state()).releases.map(({ tag_name: tag }) => tag)).toEqual(["v0.2.0"]);
    expect((await main.npm()).calls).toEqual([]);
  },
  60_000,
);

test(
  "workspace publishing does not publish the private root or private workspace",
  async () => {
    const main = await onMain("chore: release 0.2.0 (#7)", { private: true, workspace: true });
    const released = await ran($`bun ${SCRIPT}`.cwd(main.dir).env({ ...process.env, ...main.env, CHECKS_PUBLISH_WORKSPACES: "true" }));
    expect(released.exitCode).toBe(0);
    expect(released.text).toContain("release-publish: published @acme/public@0.2.0");
    expect((await main.npm()).calls.filter((call) => call === "publish")).toHaveLength(1);
    expect(await main.inOrigin("rev-parse", "v0.2.0^{commit}")).toBe(main.head);
  },
  60_000,
);

test(
  "with platformPackages under a private root the public workspace names and carries the platform packages, instead of the private root npm never receives",
  async () => {
    const main = await onMain("chore: release 0.2.0 (#7)", { private: true, workspace: true, platformPackages: true });
    const binaries = join(main.dir, "binaries");
    await mkdir(binaries);
    await writeFile(join(binaries, "widget-linux-x64"), "linux x64 build");

    const released = await ran($`bun ${SCRIPT}`.cwd(main.dir).env({ ...process.env, ...main.env, CHECKS_PUBLISH_WORKSPACES: "true", CHECKS_PLATFORM_BINARIES: binaries }));
    expect(released.exitCode).toBe(0);
    expect(released.text).toContain("release-publish: published @acme/public-linux-x64@0.2.0\n");
    expect(JSON.parse(await readFile(join(binaries, "npm", "@acme", "public-linux-x64", "package.json"), "utf8"))).toMatchObject({ name: "@acme/public-linux-x64", version: "0.2.0", os: ["linux"], cpu: ["x64"] });
    expect(JSON.parse(await readFile(join(main.dir, "packages", "public", "package.json"), "utf8"))).toEqual({ name: "@acme/public", version: "0.2.0", optionalDependencies: { "@acme/public-linux-x64": "0.2.0" } });
    expect(JSON.parse(await readFile(join(main.dir, "package.json"), "utf8"))).not.toHaveProperty("optionalDependencies");
    const looked = (await main.npm()).calls.filter((call) => call.endsWith("dist-tags --json"));
    expect(looked).toEqual(["view @acme/public-linux-x64 dist-tags --json", "view @acme/public dist-tags --json"]);
  },
  60_000,
);

test(
  "with no argument a release commit whose tree is not the one its pull request tested is refused before any tag or release",
  async () => {
    const main = await onMain("chore: release 0.2.0 (#7)", { testedOther: true });

    const refused = await main.run(SCRIPT, []);
    expect(refused.exitCode).toBe(2);
    expect(refused.text).toContain(`${main.head.slice(0, 12)} differs from the`);
    expect(refused.text).toContain("tree pull request #7 tested, so main moved after the full run");
    expect(refused.text).toContain("the next release run cuts the release again");
    expect(await main.inOrigin("tag", "--list")).toBe("");
    expect((await main.state()).releases).toEqual([]);
    expect((await main.npm()).calls).toEqual([]);
  },
  60_000,
);
