import { $ } from "bun";
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { withoutPullRequestEvent } from "../lib/env.ts";
import { CHECKOUT, fixtureRepos, ran, type FixtureRepo, type Ran } from "./lib/fixture-repo.ts";

// The oracle is the file the check reads, not a constant in the code.
const FLEET_BUN_VERSION = readFileSync(join(CHECKOUT, ".bun-version"), "utf8").trim();

const open = fixtureRepos("checks-ci-wiring-");
const SCRIPT = join(CHECKOUT, "src", "delivery", "ci-wiring.ts");
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
}, 30_000);

test("a build script requires its step and a clean git diff after it", async () => {
  const repo = await open({ "package.json": scripts(["lint"]), ".github/workflows/ci.yml": workflow.replace(/ {6}- run: (bun run build|git diff --exit-code)\n/g, "") });
  await repo.commit("start");
  expect((await wiring(repo)).text).toContain("2 gate(s) run");
  await repo.write({ "package.json": scripts(["lint", "build"]) });
  const red = await wiring(repo);
  expect(red.exitCode).toBe(1);
  expect(red.text).toContain("2 of 4 gate(s) do not run");
  expect(red.text).toContain("git diff --exit-code");
}, 30_000);

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
}, 30_000);

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
}, 30_000);

test("a private repository's event holds mutation jobs to its configured labels and every other job to a hosted default", async () => {
  const old = `\${{ vars.CI_RUNS_ON || fromJSON('["self-hosted","gpu"]') }}`;
  const mutation = (runsOn: string) => `on: pull_request\njobs:\n  mutation-compare:\n    runs-on: ${runsOn}\n    steps:\n      - run: bun run mutate\n`;
  const consumer = { name: "consumer", scripts: { lint: "lint", test: "test", mutate: "bunx stryker run" }, checks: { mutationRunner: ["self-hosted", "gpu", "x64"] } };
  const repo = await open({
    "package.json": JSON.stringify(consumer),
    ".github/workflows/ci.yml": workflow.replace("runs-on: ubuntu-latest", `runs-on: ${old}`),
    ".github/workflows/mutation-compare.yml": mutation(old),
    "event.json": JSON.stringify({ repository: { default_branch: "main", private: true } }),
  });
  await repo.commit("start");
  const privateEvent = { GITHUB_EVENT_PATH: join(repo.dir, "event.json") };
  const red = await wiring(repo, privateEvent);
  expect(red.exitCode).toBe(1);
  expect(red.text).toContain("2 job(s) run on the wrong runner");
  expect(red.text).toContain(".github/workflows/mutation-compare.yml job mutation-compare: a mutation job reads CI_RUNS_ON");
  expect(red.text).toContain(".github/workflows/ci.yml job checks: the job is not on a hosted runner");
  expect((await wiring(repo)).exitCode).toBe(1);
  await repo.write({
    "package.json": JSON.stringify({ name: "consumer", scripts: { lint: "lint", test: "test", mutate: "bunx stryker run" } }),
    ".github/workflows/ci.yml": workflow,
    ".github/workflows/mutation-compare.yml": mutation("ubuntu-latest"),
  });
  const undeclared = await wiring(repo, privateEvent);
  expect(undeclared.exitCode).toBe(1);
  expect(undeclared.text).toContain("job mutation-compare: a mutation job in a private repository names no checks.mutationRunner");
  expect((await wiring(repo)).exitCode).toBe(0);
  await repo.write({
    "package.json": JSON.stringify(consumer),
    ".github/workflows/ci.yml": workflow,
    ".github/workflows/mutation-compare.yml": mutation("ubuntu-latest"),
  });
  const hosted = await wiring(repo, privateEvent);
  expect(hosted.exitCode).toBe(1);
  expect(hosted.text).toContain("job mutation-compare: a mutation job in a private repository runs off [self-hosted, gpu, x64]");
  expect(hosted.text).toContain("job checks: the job is not on a hosted runner");
  await repo.write({
    ".github/workflows/ci.yml": workflow.replace("runs-on: ubuntu-latest", "runs-on: ${{ vars.CI_RUNS_ON || 'ubuntu-latest' }}"),
    ".github/workflows/mutation-compare.yml": mutation("[self-hosted, gpu, x64]"),
  });
  const green = await wiring(repo, privateEvent);
  expect(green.exitCode).toBe(0);
  expect(green.text).toContain("3 gate(s) run on pull requests to main");
}, 30_000);

test("a public repository refuses a self-hosted runner on a fork-reachable job", async () => {
  const repo = await open({
    "package.json": scripts(["lint", "test"]),
    "src/index.ts": "export const answer = 42;\n",
    ".github/workflows/ci.yml": workflow.replace("runs-on: ubuntu-latest", "runs-on: [self-hosted, gpu, x64]"),
    "event.json": JSON.stringify({ repository: { default_branch: "main", private: false } }),
  });
  await repo.commit("start");
  const publicEvent = { GITHUB_EVENT_PATH: join(repo.dir, "event.json") };
  const red = await wiring(repo, publicEvent);
  expect(red.exitCode).toBe(1);
  expect(red.text).toContain("1 job(s) run on the wrong runner");
  expect(red.text).toContain("job checks: a public repository runs a fork-reachable job on self-hosted labels");
  await repo.write({ ".github/workflows/ci.yml": workflow });
  expect((await wiring(repo, publicEvent)).exitCode).toBe(0);
}, 30_000);

test("a private repository's mutation job through a repository shell script in its run directory runs on its configured labels and a non-shell script does not count", async () => {
  const hosted = "${{ vars.CI_RUNS_ON || 'ubuntu-latest' }}";
  const mutationRunner = "[self-hosted, gpu, x64]";
  const runs = ["bun run mutate:incremental", "./mutate.sh", "bun run ./scripts/mutate.sh", "cd tools && ./sweep.sh"];
  const mutation = (runsOn: string) =>
    `on: pull_request\njobs:\n${runs.map((run, index) => `  sweep-${index}:\n    runs-on: ${runsOn}\n    steps:\n      - run: ${run}\n`).join("")}  report:\n    runs-on: ${hosted}\n    steps:\n      - run: scripts/report.ts\n      - run: ./mutate.sh\n        working-directory: docs\n`;
  const repo = await open({
    "package.json": JSON.stringify({ name: "consumer", scripts: { lint: "lint", test: "test", "mutate:incremental": "scripts/mutate.sh --incremental" }, checks: { mutationRunner: ["self-hosted", "gpu", "x64"] } }),
    "scripts/mutate.sh": '#!/usr/bin/env bash\nset -euo pipefail\nexec ./node_modules/.bin/stryker run "$@"\n',
    "mutate.sh": "#!/bin/sh\nscripts/mutate.sh\n",
    "tools/sweep.sh": "#!/bin/sh\ncd .. && ./mutate.sh\n",
    "docs/mutate.sh": "#!/bin/sh\necho done\n",
    "scripts/report.ts": '#!/usr/bin/env bun\nconsole.log("checks-mutation");\n',
    ".github/workflows/ci.yml": workflow.replace("runs-on: ubuntu-latest", `runs-on: ${hosted}`),
    ".github/workflows/mutation.yml": mutation(hosted),
    "event.json": JSON.stringify({ repository: { default_branch: "main", private: true } }),
  });
  await repo.commit("start");
  const privateEvent = { GITHUB_EVENT_PATH: join(repo.dir, "event.json") };
  const red = await wiring(repo, privateEvent);
  expect(red.exitCode).toBe(1);
  expect(red.text).toContain(`${runs.length} job(s) run on the wrong runner`);
  for (const index of runs.keys()) expect(red.text).toContain(`job sweep-${index}: a mutation job reads CI_RUNS_ON`);
  await repo.write({ ".github/workflows/mutation.yml": mutation(mutationRunner) });
  const green = await wiring(repo, privateEvent);
  expect(green.text).not.toContain("wrong runner");
  expect(green.exitCode).toBe(0);
}, 30_000);

test("a daily release that names a removed workflow fails until the name is gone", async () => {
  const broken = await Bun.file(join(CHECKOUT, "tests", "fixtures", "socials-daily-release-broken.yml")).text();
  const repo = await open({
    "package.json": JSON.stringify({ name: "consumer", scripts: { lint: "lint", test: "test" }, engines: { bun: FLEET_BUN_VERSION } }),
    ".github/workflows/ci.yml": workflow,
    ".github/workflows/daily-release.yml": broken,
    ".github/workflows/release.yml": "name: release\non:\n  workflow_dispatch:\njobs:\n  publish:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo publish\n",
  });
  await repo.commit("start");
  const red = await wiring(repo);
  expect(red.exitCode).toBe(1);
  expect(red.text).toContain(".github/workflows/daily-release.yml line 31");
  expect(red.text).toContain("commitlint.yml");
  await repo.write({ ".github/workflows/daily-release.yml": broken.replace(" ci.yml commitlint.yml", " ci.yml") });
  expect((await wiring(repo)).exitCode).toBe(0);
}, 30_000);

test("a drifted bun pin fails and the fleet pin passes", async () => {
  const setup = workflow.replace(
    "    steps:\n",
    "    steps:\n      - uses: oven-sh/setup-bun@v2\n        with:\n          bun-version-file: .bun-version\n",
  );
  const repo = await open({
    "package.json": scripts(["lint", "test"]),
    "src/index.ts": "export const answer = 42;\n",
    ".github/workflows/ci.yml": setup,
    ".bun-version": "1.3.13\n",
  });
  await repo.commit("start");
  const red = await wiring(repo);
  expect(red.exitCode).toBe(1);
  expect(red.text).toContain("drift from the fleet bun version");
  expect(red.text).toContain("requests bun 1.3.13 from with.bun-version-file .bun-version");
  await repo.write({ ".bun-version": `${FLEET_BUN_VERSION}\n` });
  const green = await wiring(repo);
  expect(green.exitCode).toBe(0);
  expect(green.text).toContain("3 gate(s) run");
}, 30_000);

test("a version file named in another case is read and its drifted pin fails over a fleet-pinned root", async () => {
  const setup = workflow.replace(
    "    steps:\n",
    "    steps:\n      - uses: oven-sh/setup-bun@v2\n        with:\n          Bun-Version-File: .bun-version\n",
  );
  const repo = await open({
    "package.json": JSON.stringify({ name: "consumer", scripts: { lint: "lint", test: "test" }, engines: { bun: FLEET_BUN_VERSION } }),
    "src/index.ts": "export const answer = 42;\n",
    ".github/workflows/ci.yml": setup,
    ".bun-version": "1.3.13\n",
  });
  await repo.commit("start");
  const red = await wiring(repo);
  expect(red.exitCode).toBe(1);
  expect(red.text).toContain("requests bun 1.3.13 from with.bun-version-file .bun-version");
}, 30_000);

test("a setup-bun step with no pinned version fails until the root package.json pins the fleet version", async () => {
  const setup = workflow.replace(
    "    steps:\n",
    "    steps:\n      - uses: oven-sh/setup-bun@v2\n",
  );
  const repo = await open({
    "package.json": scripts(["lint", "test"]),
    "src/index.ts": "export const answer = 42;\n",
    ".github/workflows/ci.yml": setup,
  });
  await repo.commit("start");
  const red = await wiring(repo);
  expect(red.exitCode).toBe(1);
  expect(red.text).toContain("installs latest");
  await repo.write({
    "package.json": JSON.stringify({ name: "consumer", scripts: { lint: "lint", test: "test" }, engines: { bun: FLEET_BUN_VERSION } }),
  });
  expect((await wiring(repo)).exitCode).toBe(0);
}, 30_000);
