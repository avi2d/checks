import { $ } from "bun";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fakeGh, type FakeGh } from "./fake-gh.ts";
import { fakeNpm, type FakeNpm } from "./fake-npm.ts";
import { CHECKOUT, fixtureRepos, ran, type Ran, scratchDirs } from "./fixture-repo.ts";

const CHANGELOG = join(CHECKOUT, "src", "delivery", "changelog-write.ts");

export type OnMain = {
  readonly head: string;
  readonly dir: string;
  readonly env: Readonly<Record<string, string>>;
  readonly run: (script: string, args: readonly string[]) => Promise<Ran>;
  readonly state: FakeGh["state"];
  readonly npm: FakeNpm["state"];
  readonly inOrigin: (...args: readonly string[]) => Promise<string>;
  readonly changelog: string;
};

type Shape = { readonly private?: boolean; readonly testedOther?: boolean };

function releasable(version: string, shape: Shape): string {
  const scripts = { build: `bun ${CHANGELOG}` };
  const extra = shape.private === true ? { private: true } : {};
  return `${JSON.stringify({ name: "widget", version, ...extra, repository: { type: "git", url: "git+https://github.com/acme/widget.git" }, scripts }, null, 2)}\n`;
}

// main after its release pull request squash-merged, with the origin keeping the head that pull request tested.
export function releasedMains(prefix: string): (subject: string, shape?: Shape) => Promise<OnMain> {
  const repository = fixtureRepos(prefix);
  const scratch = scratchDirs();
  return async (subject, shape = {}) => {
    const repo = await repository({ "package.json": releasable("0.1.0", shape) });
    await repo.commit("chore: add the manifest");
    await repo.write({ "notes/3.txt": "price\n" });
    await repo.commit("feat: price a bill (#3)");
    await repo.write({ "package.json": releasable("0.2.0", shape) });
    await $`bun ${CHANGELOG}`.cwd(repo.dir).quiet();
    const head = await repo.commit(subject);
    const home = await scratch(`${prefix}home-`);
    const origin = join(home, "origin.git");
    await $`git init -q --bare -b main ${origin} && git remote add origin ${origin} && git push -q origin main`.cwd(repo.dir).quiet();
    const tested =
      shape.testedOther === true
        ? (await $`git -c user.name=Wren -c user.email=wren@example.com commit-tree ${head}~1^{tree} -p ${head} -m tested`.cwd(origin).quiet()).stdout.toString().trim()
        : head;
    await $`git update-ref refs/pull/7/head ${tested}`.cwd(origin).quiet();
    const gh = await fakeGh(home, origin);
    const npm = await fakeNpm(home, "0.1.0");
    const env = { ...gh.env, ...npm.env };
    return {
      head,
      dir: repo.dir,
      env,
      run: (script, args) => ran($`bun ${script} ${args}`.cwd(repo.dir).env({ ...process.env, ...env })),
      state: gh.state,
      npm: npm.state,
      inOrigin: async (...args) => (await $`git ${args}`.cwd(origin).quiet()).stdout.toString().trim(),
      changelog: await readFile(join(repo.dir, "CHANGELOG.md"), "utf8"),
    };
  };
}
