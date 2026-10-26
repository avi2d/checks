import { expect, test } from "bun:test";
import { join } from "node:path";
import { fakeNpm, type FakeNpm } from "./lib/fake-npm.ts";
import { CHECKOUT, fixtureRepos, ran, type Ran, scratchDirs } from "./lib/fixture-repo.ts";
import { $ } from "bun";

const SCRIPT = join(CHECKOUT, "src", "delivery", "release-publish.ts");

const repository = fixtureRepos("checks-release-publish-");
const scratch = scratchDirs();

type Release = {
  readonly publish: (env?: Readonly<Record<string, string>>) => Promise<Ran>;
  readonly state: FakeNpm["state"];
};

// The release workflow's checkout of one version, with npm's `latest` dist-tag where the registry left it.
async function release(version: string, latest: string | null): Promise<Release> {
  const { dir } = await repository({ "package.json": JSON.stringify({ name: "@acme/widget", version }) });
  const npm = await fakeNpm(await scratch("checks-release-publish-npm-"), latest);
  return {
    publish: (env = {}) => ran($`bun ${SCRIPT}`.cwd(dir).env({ ...process.env, ...npm.env, ...env })),
    state: npm.state,
  };
}

test("a version above npm's latest publishes and becomes latest", async () => {
  const a = await release("0.1.1", "0.1.0");
  expect(await a.publish()).toEqual({ exitCode: 0, text: "+ @acme/widget@0.1.1\nrelease-publish: published @acme/widget@0.1.1\n" });
  expect(await a.state()).toEqual({ latest: "0.1.1", calls: ["view @acme/widget dist-tags --json", "publish"] });
});

test("the first version of a package npm does not hold yet publishes", async () => {
  const a = await release("0.1.0", null);
  expect((await a.publish()).exitCode).toBe(0);
  expect((await a.state()).latest).toBe("0.1.0");
});

test("a release that runs after a newer one published ends cleanly and leaves npm's latest on the newer version", async () => {
  const a = await release("0.1.1", "0.1.2");
  expect(await a.publish()).toEqual({
    exitCode: 0,
    text: "release-publish: npm already holds @acme/widget@0.1.2, which carries every change in 0.1.1, so 0.1.1 stays off npm\n",
  });
  expect(await a.state()).toEqual({ latest: "0.1.2", calls: ["view @acme/widget dist-tags --json"] });
});

test("a newer release that publishes while this one runs ends this one cleanly", async () => {
  const a = await release("0.1.1", "0.1.0");
  const raced = await a.publish({ FAKE_NPM_PUBLISHED_FIRST: "0.1.2" });
  expect(raced.exitCode).toBe(0);
  expect(raced.text).toContain("release-publish: npm already holds @acme/widget@0.1.2, which carries every change in 0.1.1, so 0.1.1 stays off npm\n");
  expect(await a.state()).toEqual({ latest: "0.1.2", calls: ["view @acme/widget dist-tags --json", "publish", "view @acme/widget dist-tags --json"] });
});

test("a rerun of a release npm already holds publishes nothing", async () => {
  const a = await release("0.1.1", "0.1.1");
  expect(await a.publish()).toEqual({ exitCode: 0, text: "release-publish: npm already holds @acme/widget@0.1.1\n" });
  expect((await a.state()).calls).toEqual(["view @acme/widget dist-tags --json"]);
});

test("a publish npm refuses for any other reason fails the release", async () => {
  const a = await release("0.1.1", "0.1.0");
  const refused = await a.publish({ FAKE_NPM_REFUSE: "code E403" });
  expect(refused.exitCode).toBe(2);
  expect(refused.text).toContain("checks-release-publish: npm publish refused @acme/widget@0.1.1\n");
  expect((await a.state()).latest).toBe("0.1.0");
});
