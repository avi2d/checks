import { $ } from "bun";
import { expect, test } from "bun:test";
import { join } from "node:path";
import { fakeGh, type FakeGh } from "./lib/fake-gh.ts";
import { CHECKOUT, fixtureRepos, ran, type Ran, scratchDirs } from "./lib/fixture-repo.ts";

const SCRIPT = join(CHECKOUT, "src", "delivery", "release-tag.ts");

const repository = fixtureRepos("checks-release-tag-");
const scratch = scratchDirs();

type Landed = {
  readonly head: string;
  readonly run: (...args: readonly string[]) => Promise<Ran>;
  readonly state: FakeGh["state"];
  readonly inOrigin: (...args: readonly string[]) => Promise<string>;
};

// main as a squash merge lands a commit on it, with a bare origin the tag is pushed to.
async function landed(version: string, subject: string): Promise<Landed> {
  const repo = await repository({ "package.json": JSON.stringify({ name: "widget", version }) });
  const head = await repo.commit(subject);
  const home = await scratch("checks-release-tag-home-");
  const origin = join(home, "origin.git");
  await $`git init -q --bare -b main ${origin} && git remote add origin ${origin} && git push -q origin main`.cwd(repo.dir).quiet();
  const fake = await fakeGh(home, origin);
  return {
    head,
    run: (...args) => ran($`bun ${SCRIPT} ${args}`.cwd(repo.dir).env({ ...process.env, ...fake.env })),
    state: fake.state,
    inOrigin: async (...args) => (await $`git ${args}`.cwd(origin).quiet()).stdout.toString().trim(),
  };
}

test(
  "a landed release commit is tagged with its version once, and the release workflow is dispatched on the tag",
  async () => {
    const main = await landed("0.2.0", "chore: release 0.2.0 (#7)");

    const tagged = await main.run("release.yml");
    expect(tagged).toEqual({ exitCode: 0, text: `release-tag: tagged ${main.head.slice(0, 12)} as v0.2.0, and dispatched release.yml on it\n` });
    expect(await main.inOrigin("rev-parse", "v0.2.0^{commit}")).toBe(main.head);
    expect((await main.state()).dispatches).toEqual([{ workflow: "release.yml", ref: "v0.2.0" }]);

    const again = await main.run("release.yml");
    expect(again).toEqual({ exitCode: 0, text: `release-tag: v0.2.0 already tags ${main.head.slice(0, 12)}\n` });
    expect((await main.state()).dispatches).toHaveLength(1);
  },
  60_000,
);

test(
  "a commit that releases nothing is left untagged",
  async () => {
    const main = await landed("0.2.0", "feat: price a bill (#4)");

    expect(await main.run("release.yml")).toEqual({ exitCode: 0, text: `release-tag: ${main.head.slice(0, 12)} is no release commit\n` });
    expect(await main.inOrigin("tag", "--list")).toBe("");
    expect((await main.state()).calls).toEqual([]);
  },
  60_000,
);

test(
  "a release commit whose package.json disagrees, or whose tag already sits elsewhere, is refused and dispatches nothing",
  async () => {
    const disagreeing = await landed("0.2.0", "chore: release 0.3.0 (#8)");
    const refused = await disagreeing.run("release.yml");
    expect(refused.exitCode).toBe(2);
    expect(refused.text).toContain(`checks-release-tag: ${disagreeing.head.slice(0, 12)} releases 0.3.0, but package.json holds 0.2.0`);

    const moved = await landed("0.2.0", "chore: release 0.2.0 (#7)");
    const elsewhere = await moved.inOrigin("-c", "user.name=Wren Fixture", "-c", "user.email=wren@example.com", "commit-tree", `${moved.head}^{tree}`, "-m", "elsewhere");
    await moved.inOrigin("tag", "v0.2.0", elsewhere);
    const clash = await moved.run("release.yml");
    expect(clash.exitCode).toBe(2);
    expect(clash.text).toContain(`checks-release-tag: v0.2.0 already tags ${elsewhere.slice(0, 12)}, not ${moved.head.slice(0, 12)}`);

    for (const run of [disagreeing, moved]) expect((await run.state()).dispatches).toEqual([]);
    expect((await moved.run()).text).toContain("usage: release-tag.ts <workflow>");
  },
  60_000,
);
