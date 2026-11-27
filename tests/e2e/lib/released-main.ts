import { $ } from "bun";
import { readFile, writeFile } from "node:fs/promises";
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
  readonly output: () => Promise<string>;
  readonly state: FakeGh["state"];
  readonly npm: FakeNpm["state"];
  readonly npmRegistry: FakeNpm["registry"];
  readonly inOrigin: (...args: readonly string[]) => Promise<string>;
  readonly changelog: string;
};

type Shape = { readonly private?: boolean; readonly testedOther?: boolean; readonly workspace?: boolean; readonly platformPackages?: boolean };

function releasable(version: string, shape: Shape): string {
  const scripts = { build: "bun ./scripts/build.ts" };
  const extra = { ...(shape.private === true ? { private: true } : {}), ...(shape.workspace === true ? { workspaces: ["packages/*"] } : {}) };
  return `${JSON.stringify({ name: "widget", version, ...extra, repository: { type: "git", url: "git+https://github.com/acme/widget.git" }, scripts, dependencies: { "fixture-helper": "file:./vendor/fixture-helper" } }, null, 2)}\n`;
}

// main after its release pull request squash-merged, with the origin keeping the head that pull request tested.
export function releasedMains(prefix: string): (subject: string, shape?: Shape) => Promise<OnMain> {
  const repository = fixtureRepos(prefix);
  const scratch = scratchDirs();
  return async (subject, shape = {}) => {
    const repo = await repository({ "package.json": releasable("0.1.0", shape) });
    await repo.write({
      "scripts/build.ts": `import "fixture-helper";\nawait import(${JSON.stringify(CHANGELOG)});\n`,
      "vendor/fixture-helper/package.json": JSON.stringify({ name: "fixture-helper", version: "1.0.0", type: "module" }),
      "vendor/fixture-helper/index.js": "export default 1;\n",
      ".gitignore": "node_modules/\n",
    });
    if (shape.platformPackages === true) await repo.write({ "checks.config.ts": 'export default { platformPackages: { binary: "widget", platforms: ["linux-x64"] } };\n' });
    if (shape.workspace === true) {
      await repo.write({ "packages/public/package.json": JSON.stringify({ name: "@acme/public", version: "0.1.0" }), "packages/private/package.json": JSON.stringify({ name: "@acme/private", version: "0.1.0", private: true }) });
    }
    await $`bun install`.cwd(repo.dir).quiet();
    await repo.commit("chore: add the manifest");
    await repo.write({ "notes/3.txt": "price\n" });
    await repo.commit("feat: price a bill (#3)");
    await repo.write({ "package.json": releasable("0.2.0", shape) });
    if (shape.workspace === true) await repo.write({ "packages/public/package.json": JSON.stringify({ name: "@acme/public", version: "0.2.0" }) });
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
    const output = join(home, "github-output");
    await writeFile(output, "");
    const env = { ...gh.env, ...npm.env, GITHUB_OUTPUT: output };
    return {
      head,
      dir: repo.dir,
      env,
      run: (script, args) => ran($`bun ${script} ${args}`.cwd(repo.dir).env({ ...process.env, ...env })),
      output: () => readFile(output, "utf8"),
      state: gh.state,
      npm: npm.state,
      npmRegistry: npm.registry,
      inOrigin: async (...args) => (await $`git ${args}`.cwd(origin).quiet()).stdout.toString().trim(),
      changelog: await readFile(join(repo.dir, "CHANGELOG.md"), "utf8"),
    };
  };
}
