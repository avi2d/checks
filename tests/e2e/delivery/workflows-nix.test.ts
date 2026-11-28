import { expect, test } from "bun:test";
import { Schema } from "effect";
import { join } from "node:path";
import { fixtureRepos, type FixtureRepo } from "../lib/fixture-repo.ts";

const open = fixtureRepos("checks-workflows-nix-");
const WORKFLOWS = "delivery/workflows.ts";

const decodeJobs = Schema.decodeUnknownSync(Schema.Struct({
  jobs: Schema.Record(Schema.String, Schema.Struct({ steps: Schema.optionalKey(Schema.Array(Schema.Unknown)) })),
}));

const jobsOf = async (path: string) => decodeJobs(Bun.YAML.parse(await Bun.file(path).text())).jobs;

const stepsOf = async (repo: FixtureRepo, name: string, job: string) =>
  (await jobsOf(join(repo.dir, ".github", "workflows", name)))[job]?.steps;

const verify = { run: "nix --version" };

function expectVerificationBefore(steps: readonly unknown[] | undefined, testStep: unknown) {
  expect(steps?.filter((step) => Bun.deepEquals(step, verify))).toEqual([verify]);
  const verifyIndex = steps?.findIndex((step) => Bun.deepEquals(step, verify)) ?? -1;
  expect(steps?.slice(verifyIndex, verifyIndex + 2)).toEqual([verify, testStep]);
}

test.each([
  { name: "ci.yml", job: "unit", test: expect.objectContaining({ id: "test" }) },
  { name: "ci.yml", job: "e2e", test: expect.objectContaining({ id: "test" }) },
  { name: "main.yml", job: "suite", test: expect.objectContaining({ run: "bun run test --full" }) },
])("$job checks for Nix only on opt-in and does not start tests before the check", async ({ name, job, test: testStep }) => {
  const repo = await open({
    "package.json": JSON.stringify({ name: "acme", private: true, scripts: { test: "checks-test" } }),
    "tests/e2e/one.test.ts": "export {};\n",
    "checks.config.ts": 'export default { workflows: { repositoryVisibility: "private" } };\n',
  });
  const written = await repo.script(WORKFLOWS, "--write");
  expect(written.exitCode, written.text).toBe(0);
  const baseline = await stepsOf(repo, name, job);
  expect(baseline).toContainEqual(testStep);
  expect(baseline).not.toContainEqual(verify);

  await repo.write({ "checks.config.ts": 'export default { workflows: { repositoryVisibility: "private", setupNix: true } };\n' });
  const stale = await repo.script(WORKFLOWS);
  expect(stale.exitCode, stale.text).toBe(1);
  const rewritten = await repo.script(WORKFLOWS, "--write");
  expect(rewritten.exitCode, rewritten.text).toBe(0);
  expectVerificationBefore(await stepsOf(repo, name, job), testStep);
  const accepted = await repo.script(WORKFLOWS);
  expect(accepted.exitCode, accepted.text).toBe(0);
});

test.each([undefined, "23 5 * * 1"])("flake job verifies Nix before running the suite for cron %j and keeps opt-out bytes unchanged", async (flakeCron) => {
  const workflows = { repositoryVisibility: "private", flakeCron };
  const config = (setupNix?: boolean) => "export default " + JSON.stringify({ workflows: { ...workflows, setupNix } }) + ";\n";
  const repo = await open({
    "package.json": JSON.stringify({ name: "acme", private: true, scripts: { test: "checks-test" } }),
    ".github/workflows/flake.yml": "name: flake\non:\n  workflow_dispatch:\n",
    "checks.config.ts": config(),
  });
  const written = await repo.script(WORKFLOWS, "--write");
  expect(written.exitCode, written.text).toBe(0);
  const file = Bun.file(join(repo.dir, ".github", "workflows", "flake.yml"));
  const baseline = await file.text();
  const baselineSteps = await stepsOf(repo, "flake.yml", "flake");
  expect(baselineSteps).toContainEqual({ run: "bunx checks-flake --runs 10 --report flake-report.json" });
  expect(baselineSteps).not.toContainEqual(verify);

  await repo.write({ "checks.config.ts": config(true) });
  const stale = await repo.script(WORKFLOWS);
  expect(stale.exitCode, stale.text).toBe(1);
  const rewritten = await repo.script(WORKFLOWS, "--write");
  expect(rewritten.exitCode, rewritten.text).toBe(0);
  expectVerificationBefore(await stepsOf(repo, "flake.yml", "flake"), { run: "bunx checks-flake --runs 10 --report flake-report.json" });
  const accepted = await repo.script(WORKFLOWS);
  expect(accepted.exitCode, accepted.text).toBe(0);

  await repo.write({ "checks.config.ts": config(false) });
  const disabled = await repo.script(WORKFLOWS, "--write");
  expect(disabled.exitCode, disabled.text).toBe(0);
  expect(await file.text()).toBe(baseline);
});

test("Nix opt-in never adds an installer, leaves mutation unchanged, and checks Nix before whole-tree tests", async () => {
  const config = (setupNix?: boolean) => "export default " + JSON.stringify({ workflows: { repositoryVisibility: "private", flakeCron: "23 5 * * 1", setupNix } }) + ";\n";
  const repo = await open({
    "package.json": JSON.stringify({ name: "acme", private: true, scripts: { test: "checks-test" } }),
    "tests/e2e/one.test.ts": "export {};\n",
    "checks.config.ts": config(),
  });
  const written = await repo.script(WORKFLOWS, "--write");
  expect(written.exitCode, written.text).toBe(0);
  const wholeTree = Bun.file(join(repo.dir, ".github", "workflows", "whole-tree-run.yml"));
  const mutation = Bun.file(join(repo.dir, ".github", "workflows", "mutation.yml"));
  const baseline = await wholeTree.text();
  const mutationBaseline = await mutation.text();
  const run = { run: "bunx checks-ci whole-tree tests" };
  expect(await stepsOf(repo, "whole-tree-run.yml", "tests")).toContainEqual(run);

  await repo.write({ "checks.config.ts": config(true) });
  const stale = await repo.script(WORKFLOWS);
  expect(stale.exitCode, stale.text).toBe(1);
  const rewritten = await repo.script(WORKFLOWS, "--write");
  expect(rewritten.exitCode, rewritten.text).toBe(0);
  expectVerificationBefore(await stepsOf(repo, "whole-tree-run.yml", "tests"), run);
  for await (const path of new Bun.Glob("*.{yml,yaml}").scan({ cwd: join(repo.dir, ".github", "workflows"), absolute: true })) {
    const jobs = await jobsOf(path);
    for (const { steps = [] } of Object.values(jobs)) {
      expect(steps, path).not.toContainEqual(expect.objectContaining({ uses: expect.stringContaining("install-nix-action") }));
    }
  }
  expect(await mutation.text()).toBe(mutationBaseline);
  const accepted = await repo.script(WORKFLOWS);
  expect(accepted.exitCode, accepted.text).toBe(0);

  await repo.write({ "checks.config.ts": config(false) });
  const disabled = await repo.script(WORKFLOWS, "--write");
  expect(disabled.exitCode, disabled.text).toBe(0);
  expect(await wholeTree.text()).toBe(baseline);
});

test.each([false, true])("site Nix opt-in is refused before writes when site names are held: %j", async (held) => {
  const flags = ["--pages", "acme", "--domain", "acme.example", "--production", "acme/acme.example"];
  const repo = await open({
    "package.json": JSON.stringify({ name: "acme", private: true, scripts: { test: "checks-test" } }),
    "checks.config.ts": 'export default { workflows: { setupNix: false } };\n',
  });
  const ci = Bun.file(join(repo.dir, ".github", "workflows", "ci.yml"));
  if (held) {
    const written = await repo.script(WORKFLOWS, "--write", ...flags);
    expect(written.exitCode, written.text).toBe(0);
  }
  const baseline = held ? await ci.text() : undefined;
  await repo.write({ "checks.config.ts": 'export default { workflows: { setupNix: true } };\n' });
  const names = held ? [] : flags;
  for (const command of [WORKFLOWS, "delivery/setup.ts"]) {
    const result = await repo.script(command, ...(command === WORKFLOWS ? ["--write"] : []), ...names);
    expect(result.exitCode, result.text).toBe(2);
    expect(result.text).toContain("workflows.setupNix");
    expect(result.text).toContain("a site does not support Nix setup");
  }
  if (held) {
    const result = await repo.script(WORKFLOWS);
    expect(result.exitCode, result.text).toBe(1);
    expect(result.text).toContain("a site does not support Nix setup");
    if (baseline === undefined) {
      throw new Error("the held run wrote no ci.yml baseline");
    }
    expect(await ci.text()).toBe(baseline);
  } else {
    expect(await ci.exists()).toBe(false);
  }
});
