import { $ } from "bun";
import { expect, test } from "bun:test";
import { join } from "node:path";
import { withoutPullRequestEvent } from "../lib/env.ts";
import { CHECKOUT, fixtureRepos, ran, type FixtureRepo, type Ran } from "./lib/fixture-repo.ts";

const open = fixtureRepos("checks-ci-wiring-");
const SCRIPT = join(CHECKOUT, "scripts", "ci-wiring.ts");
const workflow = `on:\n  pull_request:\n    types: [opened, synchronize]\njobs:\n  checks:\n    runs-on: ubuntu-latest\n    steps:\n      - run: bun run lint\n      - run: bun run build\n      - run: git diff --exit-code\n      - run: bun run typecheck\n      - run: bun run test\n      - run: ./node_modules/.bin/commitlint\n`;
const scripts = (names: readonly string[]): string => JSON.stringify({ name: "consumer", scripts: Object.fromEntries(names.map((name) => [name, name])) });

function wiring(repo: FixtureRepo, ci: Readonly<Record<string, string>> = {}): Promise<Ran> {
  return ran($`bun ${SCRIPT}`.cwd(repo.dir).env({ ...withoutPullRequestEvent(), ...ci }));
}

test("the installed bin refuses an omitted gate and accepts its restored step", async () => {
  const repo = await open({
    "package.json": scripts(["lint", "test"]),
    "src/index.ts": "export const answer = 42;\n",
    ".github/workflows/ci.yml": workflow.replace("      - run: bun run test\n", ""),
  });
  await repo.commit("start");
  const red = await wiring(repo);
  expect(red.exitCode).toBe(1);
  expect(red.text).toContain("bun run test");
  await repo.write({ ".github/workflows/ci.yml": workflow });
  const green = await wiring(repo);
  expect(green.exitCode).toBe(0);
  expect(green.text).toContain("3 gate(s) run");
});

test("a build script requires its step and a clean git diff after it", async () => {
  const repo = await open({ "package.json": scripts(["lint"]), ".github/workflows/ci.yml": workflow.replace(/ {6}- run: (bun run build|git diff --exit-code)\n/g, "") });
  await repo.commit("start");
  expect((await wiring(repo)).text).toContain("2 gate(s) run");
  await repo.write({ "package.json": scripts(["lint", "build"]) });
  const red = await wiring(repo);
  expect(red.exitCode).toBe(1);
  expect(red.text).toContain("2 of 4 gate(s) do not run");
  expect(red.text).toContain("git diff --exit-code");
});

test("false if and continue-on-error cannot make a required step green", async () => {
  const repo = await open({ "package.json": scripts(["lint", "test"]), "src/index.ts": "export const answer = 42;\n", ".github/workflows/ci.yml": workflow });
  await repo.commit("start");
  for (const disabled of ["if: false", "continue-on-error: true"]) {
    await repo.write({ ".github/workflows/ci.yml": workflow.replace("      - run: bun run lint", `      - run: bun run lint\n        ${disabled}`) });
    const red = await wiring(repo);
    expect(red.exitCode).toBe(1);
    expect(red.text).toContain(disabled);
  }
  await repo.write({ ".github/workflows/ci.yml": workflow });
  expect((await wiring(repo)).exitCode).toBe(0);
});

test("the default branch comes from origin HEAD, the pull request base or GitHub's event, never the workflow", async () => {
  const master = workflow.replace("    types: [opened, synchronize]\n", "    branches: [master]\n");
  const repo = await open({ "package.json": scripts(["lint", "test"]), ".github/workflows/ci.yml": master });
  await repo.commit("start");
  const unrecorded = await wiring(repo);
  expect(unrecorded.exitCode).toBe(1);
  expect(unrecorded.text).toContain("limits pull_request to branches other than main");
  await repo.write({ "push-event.json": JSON.stringify({ repository: { default_branch: "master" } }) });
  const pushed = await wiring(repo, { GITHUB_EVENT_PATH: join(repo.dir, "push-event.json") });
  expect(pushed.exitCode).toBe(0);
  expect(pushed.text).toContain("3 gate(s) run on pull requests to master");
  await $`git update-ref refs/remotes/origin/master HEAD && git symbolic-ref refs/remotes/origin/HEAD refs/remotes/origin/master`.cwd(repo.dir).quiet();
  const green = await wiring(repo);
  expect(green.exitCode).toBe(0);
  expect(green.text).toContain("3 gate(s) run on pull requests to master");
  const release = await wiring(repo, { GITHUB_BASE_REF: "release" });
  expect(release.exitCode).toBe(1);
  expect(release.text).toContain("limits pull_request to branches other than release");
});
