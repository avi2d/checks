import { $ } from "bun";
import { expect, test } from "bun:test";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fakeGh, type FakeGh } from "./lib/fake-gh.ts";
import { CHECKOUT, fixtureRepos, ran, type Ran, scratchDirs } from "./lib/fixture-repo.ts";

const SCRIPT = join(CHECKOUT, "src", "delivery", "release-push.ts");
const CHANGELOG = join(CHECKOUT, "src", "delivery", "changelog-write.ts");
const ACTIONS_BOT = "github-actions[bot] <41898282+github-actions[bot]@users.noreply.github.com>";

const repository = fixtureRepos("checks-release-push-");
const scratch = scratchDirs();

type Package = {
  readonly dir: string;
  readonly run: (args: readonly string[], env?: Readonly<Record<string, string>>) => Promise<Ran>;
  readonly commit: (message: string) => Promise<string>;
  readonly state: FakeGh["state"];
  readonly inOrigin: (...args: readonly string[]) => Promise<string>;
};

function manifest(version: string): string {
  const scripts = { build: `bun ${CHANGELOG}` };
  return `${JSON.stringify({ name: "widget", version, repository: { type: "git", url: "git+https://github.com/acme/widget.git" }, scripts }, null, 2)}\n`;
}

// A package released at v0.1.0, with one fix on main since, whose origin is a bare repository the fake gh writes into.
async function widget(): Promise<Package> {
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
  const home = await scratch("checks-release-push-home-");
  const origin = join(home, "origin.git");
  await $`git init -q --bare -b main ${origin} && git remote add origin ${origin} && git push -q origin main --tags`.cwd(dir).quiet();
  const fake = await fakeGh(home, origin);
  return {
    dir,
    run: (args, env = {}) => ran($`bun ${SCRIPT} ${args}`.cwd(dir).env({ ...process.env, ...fake.env, ...env })),
    commit,
    state: fake.state,
    inOrigin: async (...args) => (await $`git ${args}`.cwd(origin).quiet()).stdout.toString().trim(),
  };
}

async function head(dir: string): Promise<string> {
  return (await $`git rev-parse HEAD`.cwd(dir).quiet()).stdout.toString().trim();
}

test(
  "a fix since the last tag lands one release commit on main once its checks pass, tags it and dispatches the release on the tag",
  async () => {
    const pkg = await widget();
    const main = await head(pkg.dir);

    const released = await pkg.run(["release.yml", "ci.yml"]);
    expect(released.exitCode).toBe(0);
    const release = await pkg.inOrigin("rev-parse", "main");
    expect(released.text).toContain(`release-push: dispatched ci.yml on release/main to check 0.1.1 at ${release.slice(0, 12)}\n`);
    expect(released.text).toContain(`release-push: released 0.1.1 as ${release.slice(0, 12)} on main, tagged it v0.1.1, and dispatched release.yml on it\n`);
    expect(released.text).toContain(`release-push: release.yml finished on v0.1.1\n`);
    const calls = (await pkg.state()).calls;
    const dispatched = calls.indexOf("POST repos/{owner}/{repo}/actions/workflows/release.yml/dispatches");
    expect(dispatched).not.toBe(-1);
    expect(calls.slice(dispatched + 1).some((call) => call.startsWith("GET repos/{owner}/{repo}/actions/runs"))).toBe(true);

    expect(await pkg.inOrigin("log", "-1", "--format=%s%n%P%n%an <%ae>", "main")).toBe(`chore: release 0.1.1\n${main}\n${ACTIONS_BOT}`);
    expect(await pkg.inOrigin("rev-parse", "v0.1.1^{commit}")).toBe(release);
    expect(await pkg.inOrigin("diff", "--name-only", main, "main")).toBe("CHANGELOG.md\npackage.json");
    expect(await pkg.inOrigin("show", "main:package.json")).toBe(manifest("0.1.1").trim());
    const changelog = await pkg.inOrigin("show", "main:CHANGELOG.md");
    expect(changelog).toContain("## 0.1.1");
    expect(changelog).toContain("- **parts:** keep the order of parts [#3](https://github.com/acme/widget/pull/3)");

    const state = await pkg.state();
    expect(state.pulls).toEqual([]);
    expect(state.dispatches).toEqual([
      { workflow: "ci.yml", ref: "release/main" },
      { workflow: "release.yml", ref: "v0.1.1" },
    ]);
    expect((await $`git status --porcelain`.cwd(pkg.dir).quiet()).stdout.toString()).toBe("");
    expect(await readFile(join(pkg.dir, "package.json"), "utf8")).toBe(manifest("0.1.0"));
  },
  60_000,
);

test(
  "an update of main that GitHub applied but whose reply was lost still tags and releases the version",
  async () => {
    const pkg = await widget();

    const lost = await pkg.run(["release.yml", "ci.yml"], { FAKE_GH_LOSE_REPLY: "PATCH repos/{owner}/{repo}/git/refs/heads/main" });
    expect(lost.exitCode).toBe(0);
    const release = await pkg.inOrigin("rev-parse", "main");
    expect(await pkg.inOrigin("log", "-1", "--format=%s", "main")).toBe("chore: release 0.1.1");
    expect(lost.text).toContain(`release-push: released 0.1.1 as ${release.slice(0, 12)} on main, tagged it v0.1.1, and dispatched release.yml on it\n`);
    expect(lost.text).toContain(`release-push: release.yml finished on v0.1.1\n`);
    expect(await pkg.inOrigin("rev-parse", "v0.1.1^{commit}")).toBe(release);
    expect((await pkg.state()).dispatches).toEqual([
      { workflow: "ci.yml", ref: "release/main" },
      { workflow: "release.yml", ref: "v0.1.1" },
    ]);
  },
  60_000,
);

test(
  "a lost reply with a newer head on main still tags the release commit and dispatches the release",
  async () => {
    const pkg = await widget();
    const race = "feat: price a bill (#4)";
    const lost = await pkg.run(["release.yml", "ci.yml"], {
      FAKE_GH_LOSE_REPLY: "PATCH repos/{owner}/{repo}/git/refs/heads/main",
      FAKE_GH_RACE_COMMIT: race,
    });
    expect(lost.exitCode).toBe(0);
    const release = await pkg.inOrigin("rev-parse", "v0.1.1^{commit}");
    const main = await pkg.inOrigin("rev-parse", "main");
    expect(main).not.toBe(release);
    expect(await pkg.inOrigin("log", "-1", "--format=%s", "main")).toBe(race);
    expect(await pkg.inOrigin("log", "-1", "--format=%s", "v0.1.1")).toBe("chore: release 0.1.1");
    expect(lost.text).toContain(`release-push: released 0.1.1 as ${release.slice(0, 12)} on main, tagged it v0.1.1, and dispatched release.yml on it\n`);
    expect(lost.text).toContain(`release-push: release.yml finished on v0.1.1\n`);
    expect((await pkg.state()).dispatches).toEqual([
      { workflow: "ci.yml", ref: "release/main" },
      { workflow: "release.yml", ref: "v0.1.1" },
    ]);
  },
  60_000,
);

test(
  "a release workflow that concludes failure fails the run naming its run, though main holds the release and the tag exists",
  async () => {
    const pkg = await widget();
    const failed = await pkg.run(["release.yml", "ci.yml"], { FAKE_GH_CONCLUSION_RELEASE_YML: "failure" });
    expect(failed.exitCode).toBe(2);
    const release = await pkg.inOrigin("rev-parse", "main");
    expect(await pkg.inOrigin("log", "-1", "--format=%s", "main")).toBe("chore: release 0.1.1");
    expect(await pkg.inOrigin("rev-parse", "v0.1.1^{commit}")).toBe(release);
    expect(failed.text).toContain(
      `checks-release-push: the release workflow failed on ${release.slice(0, 12)}: release.yml concluded failure at https://github.com/acme/widget/actions/runs/`,
    );
    expect(failed.text).not.toContain("stays off the branch");
    expect((await pkg.state()).dispatches).toEqual([
      { workflow: "ci.yml", ref: "release/main" },
      { workflow: "release.yml", ref: "v0.1.1" },
    ]);
  },
  60_000,
);

test(
  "failed checks leave main, the tags and the release workflow alone",
  async () => {
    const pkg = await widget();
    const main = await head(pkg.dir);

    const failed = await pkg.run(["release.yml", "ci.yml"], { FAKE_GH_CONCLUSION: "failure" });
    expect(failed.exitCode).toBe(2);
    const release = await pkg.inOrigin("rev-parse", "release/main");
    expect(failed.text).toContain(
      `checks-release-push: the checks failed on ${release.slice(0, 12)}, so the release stays off the branch: ci.yml concluded failure at https://github.com/acme/widget/actions/runs/1`,
    );
    expect(await pkg.inOrigin("rev-parse", "main")).toBe(main);
    expect(await pkg.inOrigin("tag", "--list")).toBe("v0.1.0");
    expect((await pkg.state()).dispatches).toEqual([{ workflow: "ci.yml", ref: "release/main" }]);
  },
  60_000,
);

test(
  "a main that moved while the checks ran keeps its new head, and the release waits for the run on that head",
  async () => {
    const pkg = await widget();
    await pkg.commit("feat: price a bill (#4)");
    const moved = await head(pkg.dir);
    await $`git push -q origin main && git reset -q --hard HEAD~1`.cwd(pkg.dir).quiet();
    const checkedOut = await head(pkg.dir);

    const raced = await pkg.run(["release.yml", "ci.yml"]);
    expect(raced.exitCode).toBe(0);
    expect(raced.text).toContain(`release-push: main moved past ${checkedOut.slice(0, 12)} while the checks ran, so the run on its new head releases it\n`);
    expect(await pkg.inOrigin("rev-parse", "main")).toBe(moved);
    expect(await pkg.inOrigin("tag", "--list")).toBe("v0.1.0");
    expect((await pkg.state()).dispatches).toEqual([{ workflow: "ci.yml", ref: "release/main" }]);
  },
  60_000,
);

test(
  "a release commit at the head is tagged and released, and a second run finds the tag and does nothing",
  async () => {
    const pkg = await widget();
    await writeFile(join(pkg.dir, "package.json"), manifest("0.1.1"));
    await $`bun ${CHANGELOG}`.cwd(pkg.dir).quiet();
    const release = await pkg.commit("chore: release 0.1.1");
    await $`git push -q origin main`.cwd(pkg.dir).quiet();

    const tagged = await pkg.run(["release.yml", "ci.yml"]);
    expect(tagged.exitCode).toBe(0);
    expect(tagged.text).toContain(`release-push: tagged ${release.slice(0, 12)} as v0.1.1, and dispatched release.yml on it\n`);
    expect(tagged.text).toContain(`release-push: release.yml finished on v0.1.1\n`);
    expect(await pkg.inOrigin("rev-parse", "v0.1.1^{commit}")).toBe(release);

    expect(await pkg.run(["release.yml", "ci.yml"])).toEqual({ exitCode: 0, text: `release-push: v0.1.1 already tags ${release.slice(0, 12)}\n` });
    expect((await pkg.state()).dispatches).toEqual([{ workflow: "release.yml", ref: "v0.1.1" }]);
  },
  60_000,
);

test(
  "nothing unreleased, a tag the next version already holds and a missing check workflow each release nothing",
  async () => {
    const pkg = await widget();
    const usage = await pkg.run(["release.yml"]);
    expect(usage.exitCode).toBe(2);
    expect(usage.text).toContain("usage: release-push.ts <release-workflow> <workflow>...");

    await pkg.inOrigin("tag", "v0.1.1", "main");
    const taken = await pkg.run(["release.yml", "ci.yml"]);
    expect(taken.exitCode).toBe(2);
    expect(taken.text).toContain(`checks-release-push: v0.1.1 already tags ${(await head(pkg.dir)).slice(0, 12)}, so 0.1.1 cannot be released again`);
    expect((await pkg.state()).calls).toEqual([]);

    await $`git tag v0.1.1`.cwd(pkg.dir).quiet();
    expect(await pkg.run(["release.yml", "ci.yml"])).toEqual({ exitCode: 0, text: "release-push: no unreleased changes since v0.1.1\n" });
    expect((await pkg.state()).calls).toEqual([]);
  },
  60_000,
);
