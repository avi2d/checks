import { $ } from "bun";
import { join } from "node:path";
import { fakeGh, type FakeGh } from "./fake-gh.ts";
import { fakeNpm, type FakeNpm } from "./fake-npm.ts";
import { CHECKOUT, fixtureRepos, ran, type Ran, scratchDirs } from "./fixture-repo.ts";

const SCRIPT = join(CHECKOUT, "src", "delivery", "release-pr.ts");
const TAG = join(CHECKOUT, "src", "delivery", "release-tag.ts");
const CHANGELOG = join(CHECKOUT, "src", "delivery", "changelog-write.ts");

const repository = fixtureRepos("checks-release-pr-");
const scratch = scratchDirs();

type Consumer = {
  readonly dir: string;
  readonly run: (args: readonly string[], env?: Readonly<Record<string, string>>) => Promise<Ran>;
  readonly tagAndPublish: () => Promise<{ readonly result: Ran; readonly npm: FakeNpm }>;
  readonly commit: (message: string) => Promise<string>;
  readonly state: FakeGh["state"];
  readonly land: (message: string) => Promise<string>;
  readonly inOrigin: (...args: readonly string[]) => Promise<string>;
};

export function manifest(version: string): string {
  const scripts = { build: `bun ${CHANGELOG}` };
  return `${JSON.stringify({ name: "widget", version, repository: { type: "git", url: "git+https://github.com/acme/widget.git" }, scripts }, null, 2)}\n`;
}

const FIX = "fix(parts): keep the order of parts (#3)";

export async function consumer(since: readonly string[] = [FIX]): Promise<Consumer> {
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
  for (const message of since) await commit(message);
  const home = await scratch("checks-release-pr-home-");
  const origin = join(home, "origin.git");
  await $`git init -q --bare -b main ${origin} && git remote add origin ${origin} && git push -q origin main --tags`.cwd(dir).quiet();
  const fake = await fakeGh(home, origin);
  return {
    dir,
    run: (args, env = {}) => ran($`bun ${SCRIPT} ${args}`.cwd(dir).env({ ...process.env, ...fake.env, ...env })),
    tagAndPublish: async () => {
      const npm = await fakeNpm(home, "0.1.0");
      const result = await ran($`bun ${TAG}`.cwd(dir).env({ ...process.env, ...fake.env, ...npm.env }));
      return { result, npm };
    },
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

export async function head(dir: string): Promise<string> {
  return (await $`git rev-parse HEAD`.cwd(dir).quiet()).stdout.toString().trim();
}
