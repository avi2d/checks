import { $ } from "bun";
import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { withoutPullRequestEvent } from "../../lib/env.ts";
import { CHECKOUT, fixtureRepos, ran, type FixtureRepo, type Ran } from "../lib/fixture-repo.ts";

const SCRIPT = join(CHECKOUT, "src", "delivery", "workflows.ts");
const open = fixtureRepos("checks-workflows-private-root-");

const manifest = (extra: Readonly<Record<string, unknown>>): string =>
  JSON.stringify({ name: "acme", scripts: { lint: "oxlint", build: "tsc", typecheck: "tsc --noEmit", test: "bun test" }, ...extra });

function workflows(repo: FixtureRepo, args: readonly string[] = []): Promise<Ran> {
  return ran($`bun ${SCRIPT} ${args}`.cwd(repo.dir).env({ ...withoutPullRequestEvent(), GITHUB_REPOSITORY: "acme/acme" }));
}

const jobsOf = async (repo: FixtureRepo): Promise<unknown> => {
  const workflow: unknown = Bun.YAML.parse(await readFile(join(repo.dir, ".github", "workflows", "main.yml"), "utf8"));
  if (typeof workflow !== "object" || workflow === null || !("jobs" in workflow)) throw new Error("expected main.yml to hold a jobs table");
  return workflow.jobs;
};

test("platformPackages under a private root with one public workspace writes the binaries job and publishes the workspace, instead of refusing the release or dropping the binaries", async () => {
  const repo = await open({
    "package.json": manifest({ private: true, workspaces: ["packages/*"], scripts: { "release:assets": "bun scripts/assets.ts" } }),
    "packages/run/package.json": JSON.stringify({ name: "@acme/cli", version: "1.0.0" }),
    "checks.config.ts": 'export default { platformPackages: { binary: "acme", platforms: ["linux-x64"] } };\n',
  });
  await repo.commit("start");
  expect((await workflows(repo, ["--write"])).exitCode).toBe(0);
  expect(await jobsOf(repo)).toMatchObject({
    binaries: expect.anything(),
    release: {
      steps: expect.arrayContaining([
        expect.objectContaining({ run: "bunx checks-release-tag", env: expect.objectContaining({ CHECKS_PUBLISH_WORKSPACES: "true", CHECKS_PLATFORM_BINARIES: "${{ runner.temp }}/platform-binaries" }) }),
      ]),
    },
  });
  expect((await workflows(repo)).exitCode).toBe(0);
}, 30_000);

test("platformPackages under a private root with two public workspaces is refused in both modes, instead of naming the platform packages after one workspace and publishing another", async () => {
  const repo = await open({
    "package.json": manifest({ private: true, workspaces: ["packages/*"], scripts: { "release:assets": "bun scripts/assets.ts" } }),
    "packages/run/package.json": JSON.stringify({ name: "@acme/cli", version: "1.0.0" }),
    "packages/web/package.json": JSON.stringify({ name: "@acme/web", version: "1.0.0" }),
    "checks.config.ts": 'export default { platformPackages: { binary: "acme", platforms: ["linux-x64"] } };\n',
  });
  await repo.commit("start");
  const refused = { exitCode: 2, text: "workflows: checks.config.ts sets platformPackages, but the private root has more than one public workspace, so publish only one workspace\n" };
  expect(await workflows(repo, ["--write"])).toEqual(refused);
  expect(await workflows(repo)).toEqual(refused);
}, 30_000);
