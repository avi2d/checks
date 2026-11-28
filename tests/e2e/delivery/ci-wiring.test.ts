import { $ } from "bun";
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pageWorkflow } from "../../lib/doc-workflows.ts";
import { withoutPullRequestEvent } from "../../lib/env.ts";
import { CHECKOUT, fixtureRepos, ran, type FixtureRepo, type Ran } from "../lib/fixture-repo.ts";
import { MUTATION_WORKFLOW } from "../../../src/delivery/full-set/mutation.ts";
import { settingsFile } from "../lib/settings-file.ts";

// The oracle is the file the check reads, not a constant in the code.
const FLEET_BUN_VERSION = readFileSync(join(CHECKOUT, ".bun-version"), "utf8").trim();

const open = fixtureRepos("checks-ci-wiring-");
const SCRIPT = join(CHECKOUT, "src", "delivery", "ci-wiring.ts");
const workflow = `on:\n  pull_request:\n    types: [opened, synchronize]\njobs:\n  checks:\n    runs-on: ubuntu-latest\n    timeout-minutes: 10\n    steps:\n      - run: bun run lint\n      - run: bun run build\n      - run: git diff --exit-code\n      - run: bun run typecheck\n      - run: bun run test\n      - run: ./node_modules/.bin/commitlint\n`;
const nightRun = `name: night-run\non:\n  workflow_dispatch:\njobs:\n  gates:\n    runs-on: ubuntu-latest\n    timeout-minutes: 20\n    steps:\n      - run: bunx checks-lint --night\n`;
const scripts = (names: readonly string[]): string => JSON.stringify({ name: "consumer", scripts: Object.fromEntries(names.map((name) => [name, name])) });

function wiring(repo: FixtureRepo, ci: Readonly<Record<string, string>> = {}): Promise<Ran> {
  return ran($`bun ${SCRIPT}`.cwd(repo.dir).env({ ...withoutPullRequestEvent(), ...ci }));
}

test.each([
  "bunx checks-release-pr ci.yml",
  "bunx checks-release-tag",
  "bun src/delivery/release-pr.ts ci.yml",
  "bun src/delivery/release-tag.ts",
  "bun run release",
])("release tools reject an untracked CHANGELOG.md for %s", async (command) => {
  const release = `on: workflow_dispatch\njobs:\n  release:\n    runs-on: ubuntu-latest\n    timeout-minutes: 10\n    steps:\n      - run: ${command}\n`;
  const repo = await open({
    "package.json": JSON.stringify({ name: "consumer", scripts: { lint: "lint", test: "test", release: "bash scripts/release.sh" } }),
    "scripts/release.sh": "#!/bin/sh\nbunx checks-release-tag\n",
    ".github/workflows/ci.yml": workflow,
    ".github/workflows/release.yml": release,
  });
  await repo.commit("start");
  const missing = await wiring(repo);
  expect(missing.exitCode).toBe(1);
  expect(missing.text).toContain("CHANGELOG.md is missing");
  await repo.write({ "CHANGELOG.md": "# Changelog\n" });
  const untracked = await wiring(repo);
  expect(untracked.exitCode).toBe(1);
  expect(untracked.text).toContain("CHANGELOG.md is missing from HEAD");
  await repo.commit("docs: add changelog");
  expect((await wiring(repo)).exitCode).toBe(0);
}, 30_000);

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

const tieredTests = {
  "package.json": JSON.stringify({
    name: "consumer",
    scripts: { test: "checks-test", "test:unit": "checks-test --tier=unit", "test:e2e": "checks-test --tier=e2e" },
  }),
  ".github/workflows/release.yml": releaseWorkflow("bun run test --full"),
};

const tierStep = (tier: "unit" | "e2e") => `      - run: bunx checks-ci test\n        env:\n          TEST_TIER: ${tier}\n`;
const tieredPullRequest = workflow.replace("      - run: bun run test\n", tierStep("unit") + tierStep("e2e"));

test("the bin does not require a full pull request run when checks-ci test runs both tiers", async () => {
  const repo = await open({ ...tieredTests, ".github/workflows/ci.yml": tieredPullRequest });
  const result = await wiring(repo);
  expect(result.exitCode).toBe(0);
  expect(result.text).toContain("2 gate(s) run on pull requests to main");
}, 30_000);

test.each(["unit", "e2e"] as const)("a release full run cannot cover a missing %s tier on pull requests", async (tier) => {
  const repo = await open({ ...tieredTests, ".github/workflows/ci.yml": tieredPullRequest.replace(tierStep(tier), "") });
  const result = await wiring(repo);
  expect(result.exitCode).toBe(1);
  expect(result.text).toContain("1 of 2 gate(s) do not run on pull requests to main:\n  bun run test");
  expect(result.text).toContain(".github/workflows/release.yml does not trigger on pull_request");
}, 30_000);

test("the installed bin refuses a job that can run for hours and passes it once it stops within an hour", async () => {
  const repo = await open({ "package.json": scripts(["lint", "test"]), ".github/workflows/ci.yml": workflow.replace("    timeout-minutes: 10\n", "") });
  await repo.commit("start");
  const red = await wiring(repo);
  expect(red.exitCode).toBe(1);
  expect(red.text).toContain(".github/workflows/ci.yml job checks: the job sets no timeout-minutes");
  await repo.write({ ".github/workflows/ci.yml": workflow.replace("timeout-minutes: 10", "timeout-minutes: 60") });
  expect((await wiring(repo)).exitCode).toBe(0);
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

const REPOSITORY = { GITHUB_REPOSITORY: "acme/acme" };

test("a private repository names the mutation runner fault on a hand-written file, and only the written mutation file passes", async () => {
  const old = `\${{ vars.CI_RUNS_ON || fromJSON('["self-hosted","gpu"]') }}`;
  const mutation = (runsOn: string) => `on: pull_request\njobs:\n  mutation-compare:\n    runs-on: ${runsOn}\n    timeout-minutes: 10\n    steps:\n      - run: bun run mutate\n`;
  const consumer = { name: "consumer", scripts: { lint: "lint", test: "test", mutate: "bunx stryker run" } };
  const runners = settingsFile({ workflows: { mutationRunsOn: ["self-hosted", "gpu", "x64"] } });
  const repo = await open({
    "package.json": JSON.stringify(consumer),
    ".bun-version": `${FLEET_BUN_VERSION}\n`,
    "checks.config.ts": runners,
    ".github/workflows/ci.yml": workflow.replace("runs-on: ubuntu-latest", `runs-on: ${old}`),
    ".github/workflows/mutation-compare.yml": mutation(old),
    "event.json": JSON.stringify({ repository: { default_branch: "main", private: true } }),
  });
  await repo.commit("start");
  const privateEvent = { ...REPOSITORY, GITHUB_EVENT_PATH: join(repo.dir, "event.json") };
  const red = await wiring(repo, privateEvent);
  expect(red.exitCode).toBe(1);
  expect(red.text).toContain("2 job(s) run on the wrong runner");
  expect(red.text).toContain(".github/workflows/mutation-compare.yml job mutation-compare: a mutation job reads CI_RUNS_ON");
  expect(red.text).toContain(".github/workflows/ci.yml job checks: the job is not on a hosted runner");
  expect((await wiring(repo, REPOSITORY)).exitCode).toBe(1);
  await repo.write({
    "checks.config.ts": settingsFile({}),
    ".github/workflows/ci.yml": workflow,
    ".github/workflows/mutation-compare.yml": mutation("ubuntu-latest"),
  });
  const undeclared = await wiring(repo, privateEvent);
  expect(undeclared.exitCode).toBe(1);
  expect(undeclared.text).toContain("job mutation-compare: a mutation job in a private repository has no workflows.mutationRunsOn in checks.config.ts");
  const unknown = await wiring(repo, REPOSITORY);
  expect(unknown.exitCode).toBe(1);
  expect(unknown.text).toContain("1 job(s) run mutation outside the mutation workflow");
  await repo.write({
    "checks.config.ts": runners,
    ".github/workflows/ci.yml": workflow,
    ".github/workflows/mutation-compare.yml": mutation("ubuntu-latest"),
  });
  const hosted = await wiring(repo, privateEvent);
  expect(hosted.exitCode).toBe(1);
  expect(hosted.text).toContain("job mutation-compare: a mutation job in a private repository runs off [self-hosted, gpu, x64]");
  expect(hosted.text).toContain("job checks: the job is not on a hosted runner");
  await repo.write({
    ".github/workflows/ci.yml": workflow.replace("runs-on: ubuntu-latest", "runs-on: ${{ vars.CI_RUNS_ON || 'ubuntu-latest' }}"),
    ".github/workflows/mutation.yml": MUTATION_WORKFLOW,
  });
  await $`rm .github/workflows/mutation-compare.yml`.cwd(repo.dir).quiet();
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

test("runner labels left under package.json checks are refused naming the checks.config.ts key, instead of judging the jobs without them", async () => {
  const repo = await open({
    "package.json": JSON.stringify({ name: "consumer", scripts: { lint: "lint", test: "test" }, checks: { selfHostedRunners: [["self-hosted", "gpu"]] } }),
    ".github/workflows/ci.yml": workflow,
    "event.json": JSON.stringify({ repository: { default_branch: "main", private: true } }),
  });
  await repo.commit("start");
  const refused = await wiring(repo, { ...REPOSITORY, GITHUB_EVENT_PATH: join(repo.dir, "event.json") });
  expect(refused.text).toContain("package.json checks.selfHostedRunners is no longer read; move it to the workflows.selfHostedRunsOn key of checks.config.ts");
  expect(refused.exitCode).toBe(2);
}, 30_000);

test("a private repository's shell-traced mutation jobs are refused outside the written workflow while its report job is not flagged, and the written file passes", async () => {
  const hosted = "${{ vars.CI_RUNS_ON || 'ubuntu-latest' }}";
  const runs = ["bun run mutate:incremental", "./mutate.sh", "bun run ./scripts/mutate.sh", "cd tools && ./sweep.sh"];
  const mutation = (runsOn: string) =>
    `on: pull_request\njobs:\n${runs.map((run, index) => `  sweep-${index}:\n    runs-on: ${runsOn}\n    timeout-minutes: 10\n    steps:\n      - run: ${run}\n`).join("")}  report:\n    runs-on: ${hosted}\n    timeout-minutes: 10\n    steps:\n      - run: scripts/report.ts\n      - run: ./mutate.sh\n        working-directory: docs\n`;
  const repo = await open({
    "package.json": JSON.stringify({ name: "consumer", scripts: { lint: "lint", test: "test", "mutate:incremental": "scripts/mutate.sh --incremental" } }),
    ".bun-version": `${FLEET_BUN_VERSION}\n`,
    "checks.config.ts": settingsFile({ workflows: { mutationRunsOn: ["self-hosted", "gpu", "x64"] } }),
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
  const privateEvent = { ...REPOSITORY, GITHUB_EVENT_PATH: join(repo.dir, "event.json") };
  const red = await wiring(repo, privateEvent);
  expect(red.exitCode).toBe(1);
  expect(red.text).toContain(`${runs.length} job(s) run on the wrong runner`);
  for (const index of runs.keys()) expect(red.text).toContain(`job sweep-${index}: a mutation job reads CI_RUNS_ON`);
  expect(red.text).toContain("4 job(s) run mutation outside the mutation workflow");
  for (const index of runs.keys()) expect(red.text).toContain(`job sweep-${index}: run mutation only from the .github/workflows/mutation.yml checks-setup writes`);
  expect(red.text).not.toContain("job report:");
  await repo.write({ ".github/workflows/mutation.yml": MUTATION_WORKFLOW });
  const green = await wiring(repo, privateEvent);
  expect(green.text).not.toContain("wrong runner");
  expect(green.text).not.toContain("outside the mutation workflow");
  expect(green.text).toContain("3 gate(s) run on pull requests to main");
  expect(green.exitCode).toBe(0);
}, 30_000);

test("a mutation.yml edited away from the file checks-setup writes, or calling avi2d/workflows, is refused, and only the written file passes", async () => {
  const caller = "name: mutation\non:\n  workflow_dispatch:\njobs:\n  mutation:\n    uses: avi2d/workflows/.github/workflows/mutation.yml@v3\n    permissions: { contents: read, actions: write, pull-requests: write }\n";
  const edited = MUTATION_WORKFLOW.replace("  workflow_dispatch:", "  push:\n    branches: [main]\n    paths: [\"src/**\"]\n  workflow_dispatch:");
  const repo = await open({ "package.json": scripts(["lint", "test"]), ".bun-version": `${FLEET_BUN_VERSION}\n`, ".github/workflows/ci.yml": workflow, ".github/workflows/mutation.yml": caller });
  await repo.commit("start");
  const refused = await wiring(repo, REPOSITORY);
  expect(refused.exitCode).toBe(1);
  expect(refused.text).toContain("ci-wiring: .github/workflows/mutation.yml differs from the file checks-setup writes: delete it and run checks-setup to write it again");
  await repo.write({ ".github/workflows/mutation.yml": edited });
  expect((await wiring(repo, REPOSITORY)).text).toContain(".github/workflows/mutation.yml differs from the file checks-setup writes");
  await repo.write({ ".github/workflows/mutation.yml": MUTATION_WORKFLOW });
  const green = await wiring(repo, REPOSITORY);
  expect(green.text).not.toContain("differs from the file");
  expect(green.exitCode).toBe(0);
}, 30_000);

test("a hand-rolled stryker run job is refused in any repository and passes once mutation runs from the written mutation.yml", async () => {
  const handRolled = "on: workflow_dispatch\njobs:\n  mutation:\n    runs-on: ubuntu-latest\n    timeout-minutes: 60\n    steps:\n      - run: bunx stryker run --incremental\n";
  const repo = await open({ "package.json": scripts(["lint", "test"]), ".bun-version": `${FLEET_BUN_VERSION}\n`, ".github/workflows/ci.yml": workflow, ".github/workflows/mutation.yml": handRolled });
  await repo.commit("start");
  const red = await wiring(repo, REPOSITORY);
  expect(red.exitCode).toBe(1);
  expect(red.text).toContain("ci-wiring: 1 job(s) run mutation outside the mutation workflow:\n  .github/workflows/mutation.yml job mutation: run mutation only from the .github/workflows/mutation.yml checks-setup writes");
  await repo.write({ ".github/workflows/mutation.yml": MUTATION_WORKFLOW });
  const green = await wiring(repo, REPOSITORY);
  expect(green.text).not.toContain("outside the mutation workflow");
  expect(green.exitCode).toBe(0);
}, 30_000);

function releaseWorkflow(run: string): string {
  return `name: release\non:\n  workflow_dispatch:\njobs:\n  publish:\n    runs-on: ubuntu-latest\n    timeout-minutes: 10\n    steps:\n      - run: ${run}\n`;
}

test("the installed bin passes a daily release only in a package published to npm, refuses it in one that is not or that sets private, and passes the by-hand template", async () => {
  const byHand = await pageWorkflow("docs/gates/checks-release-pr.md", "release-pr");
  const daily = byHand.replace("name: release-pr\non:\n", 'name: daily-release\non:\n  schedule:\n    - cron: "7 3 * * *"\n');
  const repo = await open({
    "package.json": scripts(["lint", "test"]),
    ".bun-version": `${FLEET_BUN_VERSION}\n`,
    ".github/workflows/ci.yml": workflow,
    ".github/workflows/daily-release.yml": daily,
    ".github/workflows/release.yml": releaseWorkflow("echo publish"),
    "CHANGELOG.md": "# Changelog\n",
  });
  await repo.commit("start");
  const report = "ci-wiring: 1 workflow(s) release on a schedule:\n  .github/workflows/daily-release.yml line 3: only a public package that publishes to npm releases on a schedule; drop the schedule, so a release runs only when someone starts it";
  const unpublished = await wiring(repo);
  expect(unpublished.exitCode).toBe(1);
  expect(unpublished.text).toContain(report);
  await repo.write({ ".github/workflows/release.yml": releaseWorkflow("npm publish") });
  const published = await wiring(repo);
  expect(published.text).not.toContain("release on a schedule");
  expect(published.exitCode).toBe(0);
  await repo.write({ "package.json": JSON.stringify({ name: "consumer", scripts: { lint: "lint", test: "test" }, private: true }) });
  const unlisted = await wiring(repo);
  expect(unlisted.exitCode).toBe(1);
  expect(unlisted.text).toContain(report);
  await $`git rm -q .github/workflows/daily-release.yml`.cwd(repo.dir).quiet();
  await repo.write({ ".github/workflows/release-pr.yml": byHand });
  const green = await wiring(repo);
  expect(green.text).not.toContain("schedule");
  expect(green.exitCode).toBe(0);
}, 30_000);

test("the installed bin refuses a schedule that reaches checks-release-pr through a bash shell wrapper", async () => {
  const repo = await open({
    "package.json": scripts(["lint", "test"]),
    ".bun-version": `${FLEET_BUN_VERSION}\n`,
    ".github/workflows/ci.yml": workflow,
    ".github/workflows/nightly.yml": 'name: nightly\non:\n  schedule:\n    - cron: "7 3 * * *"\njobs:\n  job:\n    runs-on: ubuntu-latest\n    timeout-minutes: 10\n    steps:\n      - run: bash scripts/release.sh\n',
    "scripts/release.sh": "#!/bin/sh\nbunx checks-release-pr ci.yml\n",
  });
  await repo.commit("start");
  const red = await wiring(repo);
  expect(red.exitCode).toBe(1);
  expect(red.text).toContain("ci-wiring: 1 workflow(s) release on a schedule:\n  .github/workflows/nightly.yml line 3: only a public package that publishes to npm releases on a schedule; drop the schedule, so a release runs only when someone starts it");
}, 30_000);

test("the installed bin refuses a schedule that reaches checks-release-pr through chained shell scripts under bun --cwd", async () => {
  const repo = await open({
    "package.json": scripts(["lint", "test"]),
    ".bun-version": `${FLEET_BUN_VERSION}\n`,
    ".github/workflows/ci.yml": workflow,
    ".github/workflows/nightly.yml": 'name: nightly\non:\n  schedule:\n    - cron: "7 3 * * *"\njobs:\n  job:\n    runs-on: ubuntu-latest\n    timeout-minutes: 10\n    steps:\n      - run: bun --cwd tools run ./release.sh\n',
    "tools/release.sh": "#!/bin/sh\n./cut.sh\n",
    "tools/cut.sh": "#!/bin/sh\nbunx checks-release-pr ci.yml\n",
  });
  await repo.commit("start");
  const red = await wiring(repo);
  expect(red.exitCode).toBe(1);
  expect(red.text).toContain("ci-wiring: 1 workflow(s) release on a schedule:\n  .github/workflows/nightly.yml line 3: only a public package that publishes to npm releases on a schedule; drop the schedule, so a release runs only when someone starts it");
}, 30_000);

test("the installed bin refuses a schedule that reaches checks-release-pr past a mutation call in the same shell wrapper", async () => {
  const repo = await open({
    "package.json": scripts(["lint", "test"]),
    ".bun-version": `${FLEET_BUN_VERSION}\n`,
    ".github/workflows/ci.yml": workflow,
    ".github/workflows/nightly.yml": 'name: nightly\non:\n  schedule:\n    - cron: "7 3 * * *"\njobs:\n  job:\n    runs-on: ubuntu-latest\n    timeout-minutes: 10\n    steps:\n      - run: ./scripts/release.sh\n',
    "scripts/release.sh": "#!/bin/sh\nbunx checks-mutation && ./scripts/cut.sh\n",
    "scripts/cut.sh": "#!/bin/sh\nbunx checks-release-pr ci.yml\n",
  });
  await repo.commit("start");
  const red = await wiring(repo);
  expect(red.exitCode).toBe(1);
  expect(red.text).toContain("ci-wiring: 1 workflow(s) release on a schedule:\n  .github/workflows/nightly.yml line 3: only a public package that publishes to npm releases on a schedule; drop the schedule, so a release runs only when someone starts it");
}, 30_000);

test("the installed bin refuses a schedule that runs a release package script through bun --env-file", async () => {
  const repo = await open({
    "package.json": JSON.stringify({ name: "consumer", scripts: { lint: "lint", test: "test", release: "checks-release-pr ci.yml" } }),
    ".bun-version": `${FLEET_BUN_VERSION}\n`,
    ".github/workflows/ci.yml": workflow,
    ".github/workflows/nightly.yml": 'name: nightly\non:\n  schedule:\n    - cron: "7 3 * * *"\njobs:\n  job:\n    runs-on: ubuntu-latest\n    timeout-minutes: 10\n    steps:\n      - run: bun --env-file .env run release\n',
  });
  await repo.commit("start");
  const red = await wiring(repo);
  expect(red.exitCode).toBe(1);
  expect(red.text).toContain("ci-wiring: 1 workflow(s) release on a schedule:\n  .github/workflows/nightly.yml line 3: only a public package that publishes to npm releases on a schedule; drop the schedule, so a release runs only when someone starts it");
}, 30_000);

test("a daily release that names a removed workflow fails until the name is gone", async () => {
  const recorded = await Bun.file(join(CHECKOUT, "tests", "fixtures", "socials-daily-release-broken.yml")).text();
  const broken = recorded.replace('  schedule:\n    - cron: "29 3 * * *"\n', "");
  const repo = await open({
    "package.json": JSON.stringify({ name: "consumer", scripts: { lint: "lint", test: "test" }, engines: { bun: FLEET_BUN_VERSION } }),
    ".github/workflows/ci.yml": workflow,
    "CHANGELOG.md": "# Changelog\n",
    ".github/workflows/daily-release.yml": broken,
    ".github/workflows/release.yml": releaseWorkflow("echo publish"),
  });
  await repo.commit("start");
  const red = await wiring(repo);
  expect(red.exitCode).toBe(1);
  expect(red.text).toContain(".github/workflows/daily-release.yml line 29");
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

test("a TypeScript repository passes with no whole-tree step, and a stale night-run.yml beside it still passes", async () => {
  const repo = await open({
    "package.json": scripts(["lint", "test"]),
    "src/index.ts": "export const answer = 42;\n",
    ".github/workflows/ci.yml": workflow,
  });
  await repo.commit("start");
  const bare = await wiring(repo);
  expect(bare.exitCode).toBe(0);
  expect(bare.text).not.toContain("1 gate(s) never run on the night run");
  await repo.write({ ".github/workflows/night-run.yml": nightRun });
  expect((await wiring(repo)).exitCode).toBe(0);
}, 30_000);

test("a repository that tracks no TypeScript passes", async () => {
  const repo = await open({
    "package.json": scripts(["lint", "test"]),
    ".github/workflows/ci.yml": workflow,
  });
  await repo.commit("start");
  expect((await wiring(repo)).exitCode).toBe(0);
}, 30_000);
