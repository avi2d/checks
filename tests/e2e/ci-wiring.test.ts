import { $ } from "bun";
import { expect, test } from "bun:test";
import { join } from "node:path";
import { withoutPullRequestEvent } from "../lib/env.ts";
import { CHECKOUT, fixtureRepos, ran, type FixtureRepo, type Ran } from "./lib/fixture-repo.ts";

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

test("a private repository's event holds mutation jobs to winbox and every other job to a hosted default", async () => {
  const old = `\${{ vars.CI_RUNS_ON || fromJSON('["self-hosted","Linux","X64","winbox"]') }}`;
  const mutation = (runsOn: string) => `on: pull_request\njobs:\n  mutation-compare:\n    runs-on: ${runsOn}\n    steps:\n      - run: bun run mutate\n`;
  const repo = await open({
    "package.json": JSON.stringify({ name: "consumer", scripts: { lint: "lint", test: "test", mutate: "bunx stryker run" } }),
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
  await repo.write({ ".github/workflows/ci.yml": workflow, ".github/workflows/mutation-compare.yml": mutation("ubuntu-latest") });
  expect((await wiring(repo)).exitCode).toBe(0);
  const hosted = await wiring(repo, privateEvent);
  expect(hosted.exitCode).toBe(1);
  expect(hosted.text).toContain("job mutation-compare: a mutation job in a private repository runs off winbox");
  expect(hosted.text).toContain("job checks: the job is not on a hosted runner");
  await repo.write({
    ".github/workflows/ci.yml": workflow.replace("runs-on: ubuntu-latest", "runs-on: ${{ vars.CI_RUNS_ON || 'ubuntu-latest' }}"),
    ".github/workflows/mutation-compare.yml": mutation("[self-hosted, Linux, X64, winbox]"),
  });
  const green = await wiring(repo, privateEvent);
  expect(green.exitCode).toBe(0);
  expect(green.text).toContain("3 gate(s) run on pull requests to main");
});

test("a private repository's mutation job through a repository shell script in its run directory runs on winbox and a non-shell script does not count", async () => {
  const hosted = "${{ vars.CI_RUNS_ON || 'ubuntu-latest' }}";
  const winbox = "[self-hosted, Linux, X64, winbox]";
  const runs = ["bun run mutate:incremental", "./mutate.sh", "bun run ./scripts/mutate.sh", "cd tools && ./sweep.sh"];
  const mutation = (runsOn: string) =>
    `on: pull_request\njobs:\n${runs.map((run, index) => `  sweep-${index}:\n    runs-on: ${runsOn}\n    steps:\n      - run: ${run}\n`).join("")}  report:\n    runs-on: ${hosted}\n    steps:\n      - run: scripts/report.ts\n      - run: ./mutate.sh\n        working-directory: docs\n`;
  const repo = await open({
    "package.json": JSON.stringify({ name: "consumer", scripts: { lint: "lint", test: "test", "mutate:incremental": "scripts/mutate.sh --incremental" } }),
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
  await repo.write({ ".github/workflows/mutation.yml": mutation(winbox) });
  const green = await wiring(repo, privateEvent);
  expect(green.text).not.toContain("wrong runner");
  expect(green.exitCode).toBe(0);
});
