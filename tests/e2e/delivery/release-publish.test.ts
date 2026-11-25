import { expect, test } from "bun:test";
import { join } from "node:path";
import { fakeNpm, type FakeNpm } from "../lib/fake-npm.ts";
import { CHECKOUT, fixtureRepos, ran, type Ran, scratchDirs } from "../lib/fixture-repo.ts";
import { $ } from "bun";

const SCRIPT = join(CHECKOUT, "src", "delivery", "release-publish.ts");

const repository = fixtureRepos("checks-release-publish-");
const scratch = scratchDirs();

type Release = {
  readonly publish: (env?: Readonly<Record<string, string>>) => Promise<Ran>;
  readonly state: FakeNpm["state"];
  readonly head: string;
};

async function release(version: string, latest: string | null, polling: "real" | "immediate" = "real"): Promise<Release> {
  const repo = await repository({ "package.json": JSON.stringify({ name: "@acme/widget", version }) });
  const head = await repo.commit(`chore: release ${version}`);
  const npm = await fakeNpm(await scratch("checks-release-publish-npm-"), latest);
  return {
    publish: (env = {}) => {
      const command = polling === "real"
        ? $`bun ${SCRIPT}`.cwd(repo.dir)
        : $`bun --eval ${`import { Effect } from "effect"; import { publishPackage } from ${JSON.stringify(SCRIPT)}; import { runMain } from ${JSON.stringify(join(CHECKOUT, "src", "core", "main.ts"))}; runMain("checks-release-publish", publishPackage(${JSON.stringify(repo.dir)}, () => Effect.void));`}`.cwd(CHECKOUT);
      return ran(command.env({ ...process.env, ...npm.env, ...env }));
    },
    state: npm.state,
    head,
  };
}

test("a version above npm's latest publishes and becomes latest", async () => {
  const a = await release("0.1.1", "0.1.0");
  expect(await a.publish()).toEqual({ exitCode: 0, text: "+ @acme/widget@0.1.1\nrelease-publish: published @acme/widget@0.1.1\n" });
  expect(await a.state()).toEqual({ latest: "0.1.1", calls: ["view @acme/widget dist-tags --json", "view @acme/widget@0.1.1 dist.shasum --json", "publish"], published: [a.head] });
}, 30_000);

test("the first version of a package npm does not hold yet publishes", async () => {
  const a = await release("0.1.0", null);
  expect((await a.publish()).exitCode).toBe(0);
  expect((await a.state()).latest).toBe("0.1.0");
}, 30_000);

test("a release that runs after a newer one published ends cleanly and leaves npm's latest on the newer version", async () => {
  const a = await release("0.1.1", "0.1.2");
  expect(await a.publish()).toEqual({
    exitCode: 0,
    text: "release-publish: npm already holds @acme/widget@0.1.2, which carries every change in 0.1.1, so 0.1.1 stays off npm\n",
  });
  expect(await a.state()).toEqual({ latest: "0.1.2", calls: ["view @acme/widget dist-tags --json"], published: [] });
}, 30_000);

test("a publish refusal stays green when a newer release publishes while it runs", async () => {
  const a = await release("0.1.1", "0.1.0");
  const raced = await a.publish({ FAKE_NPM_PUBLISHED_FIRST: "0.1.2" });
  expect(raced.exitCode).toBe(0);
  expect(raced.text).toContain("release-publish: npm already holds @acme/widget@0.1.2, which carries every change in 0.1.1, so 0.1.1 stays off npm\n");
  expect(await a.state()).toEqual({ latest: "0.1.2", calls: ["view @acme/widget dist-tags --json", "view @acme/widget@0.1.1 dist.shasum --json", "publish", "view @acme/widget dist-tags --json"], published: [] });
}, 30_000);

test("a rerun of a release npm already holds publishes nothing", async () => {
  const a = await release("0.1.1", "0.1.1");
  expect(await a.publish()).toEqual({ exitCode: 0, text: "release-publish: npm already holds @acme/widget@0.1.1\n" });
  expect((await a.state()).calls).toEqual(["view @acme/widget dist-tags --json"]);
}, 30_000);

const shasum = "df443a432e0632f91433878d7a807a91df42d6a8";
const staged = 'code E409\nnpm error 409 Conflict - Cannot publish over previously staged version "0.23.0".';
const published = "code E403\nnpm error You cannot publish over the previously published versions: 0.23.0.";
const codeless = '409 Conflict - PUT https://registry.npmjs.org/@avi2dg%2forc - Cannot publish over previously staged version "0.23.0".';

function duplicate(refusal: string, visibleAfter: number): Readonly<Record<string, string>> {
  return {
    FAKE_NPM_REFUSE: refusal,
    FAKE_NPM_PUBLISH_SHASUM: shasum,
    FAKE_NPM_SHASUM: shasum,
    FAKE_NPM_VISIBLE_AFTER: String(visibleAfter),
  };
}

test("a staged E409 with a matching shasum stays green and a rerun never republishes", async () => {
  const a = await release("0.23.0", "0.22.0");
  const env = duplicate(staged, 1);
  const result = await a.publish(env);
  expect(result.exitCode).toBe(0);
  expect(result.text).toContain("release-publish: npm holds @acme/widget@0.23.0 with the same shasum\n");
  expect((await a.state()).calls).toEqual([
    "view @acme/widget dist-tags --json",
    "view @acme/widget@0.23.0 dist.shasum --json",
    "publish",
    "view @acme/widget dist-tags --json",
    "view @acme/widget@0.23.0 dist.shasum --json",
  ]);
  expect(await a.publish(env)).toEqual({ exitCode: 0, text: "release-publish: npm already holds @acme/widget@0.23.0\n" });
  const state = await a.state();
  expect(state.calls.filter((call) => call === "publish")).toHaveLength(1);
  expect(state.published).toEqual([]);
}, 30_000);

test("a publish refusal stays green when the same version becomes latest without a shasum", async () => {
  const a = await release("0.23.0", "0.22.0");
  const result = await a.publish({ FAKE_NPM_PUBLISHED_FIRST: "0.23.0" });
  expect(result.exitCode).toBe(0);
  expect(result.text).toContain("release-publish: npm already holds @acme/widget@0.23.0\n");
  expect(await a.state()).toEqual({
    latest: "0.23.0", published: [],
    calls: ["view @acme/widget dist-tags --json", "view @acme/widget@0.23.0 dist.shasum --json", "publish", "view @acme/widget dist-tags --json"],
  });
}, 30_000);

test("a visible version with a lagging latest skips publish instead of uploading it twice", async () => {
  const a = await release("0.23.0", "0.22.0");
  expect(await a.publish({ FAKE_NPM_SHASUM: shasum })).toEqual({
    exitCode: 0, text: "release-publish: npm already holds @acme/widget@0.23.0\n",
  });
  expect(await a.state()).toEqual({
    latest: "0.22.0", published: [],
    calls: ["view @acme/widget dist-tags --json", "view @acme/widget@0.23.0 dist.shasum --json"],
  });
}, 30_000);

test.each([staged, published, codeless])("a duplicate refusal waits instead of rejecting a delayed matching tarball: %s", async (refusal) => {
  const a = await release("0.23.0", "0.22.0", "immediate");
  const result = await a.publish(duplicate(refusal, 2));
  expect(result.exitCode).toBe(0);
  expect(result.text).toContain("release-publish: npm holds @acme/widget@0.23.0 with the same shasum\n");

  const state = await a.state();
  expect(state.latest).toBe("0.22.0");
  expect(state.calls.filter((call) => call === "view @acme/widget@0.23.0 dist.shasum --json")).toHaveLength(3);
  expect(state.calls.filter((call) => call === "publish")).toHaveLength(1);
  expect(state.published).toEqual([]);
}, 30_000);

test.each([staged, published, codeless])("a duplicate refusal rejects a different tarball instead of accepting any visible version: %s", async (refusal) => {
  const a = await release("0.23.0", "0.22.0");
  const result = await a.publish({ ...duplicate(refusal, 1), FAKE_NPM_SHASUM: "0000000000000000000000000000000000000000" });
  expect(result.exitCode).toBe(2);
  expect(result.text).toContain("checks-release-publish: npm publish refused @acme/widget@0.23.0\n");
  expect((await a.state()).published).toEqual([]);
}, 30_000);

test.each([staged, published, codeless])("a duplicate refusal rejects a version that never appears instead of claiming success: %s", async (refusal) => {
  const a = await release("0.23.0", "0.22.0", "immediate");
  const result = await a.publish(duplicate(refusal, 11));
  expect(result.exitCode).toBe(2);
  expect(result.text).toContain("checks-release-publish: npm publish refused @acme/widget@0.23.0\n");
  const state = await a.state();
  expect(state.calls.filter((call) => call === "view @acme/widget@0.23.0 dist.shasum --json")).toHaveLength(11);
  expect(state.published).toEqual([]);
}, 30_000);

test("an unrelated E403 cannot use a visible shasum to hide a publish failure", async () => {
  const a = await release("0.23.0", "0.22.0");
  const result = await a.publish(duplicate("code E403\nnpm error permission denied", 1));
  expect(result.exitCode).toBe(2);
  expect((await a.state()).calls.filter((call) => call.includes("dist.shasum"))).toHaveLength(1);
}, 30_000);

test("a publish npm refuses for any other reason fails the release", async () => {
  const a = await release("0.1.1", "0.1.0");
  const refused = await a.publish({ FAKE_NPM_REFUSE: "code E403" });
  expect(refused.exitCode).toBe(2);
  expect(refused.text).toContain("checks-release-publish: npm publish refused @acme/widget@0.1.1\n");
  expect((await a.state()).latest).toBe("0.1.0");
}, 30_000);
