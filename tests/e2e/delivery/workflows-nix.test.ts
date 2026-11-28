import { expect, test } from "bun:test";
import { Schema } from "effect";
import { join } from "node:path";
import { fixtureRepos, type FixtureRepo } from "../lib/fixture-repo.ts";

const open = fixtureRepos("checks-workflows-nix-");
const WORKFLOWS = "delivery/workflows.ts";

const decodeJobs = Schema.decodeUnknownSync(Schema.Struct({
  jobs: Schema.Record(Schema.String, Schema.Struct({ steps: Schema.Array(Schema.Unknown) })),
}));

const stepsOf = async (repo: FixtureRepo, name: string, job: string) =>
  decodeJobs(Bun.YAML.parse(await Bun.file(join(repo.dir, ".github", "workflows", name)).text())).jobs[job]?.steps;

const install = { if: "runner.environment == 'github-hosted'", uses: "cachix/install-nix-action@382a9ed9481c7c1f94f68b72ef105b3417c73877" };
const verify = { run: "nix --version" };

test.each([
  { name: "ci.yml", job: "unit", test: expect.objectContaining({ id: "test" }) },
  { name: "ci.yml", job: "e2e", test: expect.objectContaining({ id: "test" }) },
  { name: "main.yml", job: "suite", test: expect.objectContaining({ run: "bun run test --full" }) },
])("$job sets up Nix only on opt-in instead of installing Nix on a self-hosted runner or running tests before verification", async ({ name, job, test: testStep }) => {
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
  expect(baseline).not.toContainEqual(expect.objectContaining({ uses: expect.stringContaining("cachix/install-nix-action") }));

  await repo.write({ "checks.config.ts": 'export default { workflows: { repositoryVisibility: "private", setupNix: true } };\n' });
  const stale = await repo.script(WORKFLOWS);
  expect(stale.exitCode, stale.text).toBe(1);
  const rewritten = await repo.script(WORKFLOWS, "--write");
  expect(rewritten.exitCode, rewritten.text).toBe(0);
  const steps = await stepsOf(repo, name, job);
  const installIndex = steps?.findIndex((step) => Bun.deepEquals(step, install)) ?? -1;
  expect(installIndex).toBeGreaterThanOrEqual(0);
  expect(steps?.slice(installIndex, installIndex + 3)).toEqual([install, verify, testStep]);
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
  const steps = await stepsOf(repo, "flake.yml", "flake");
  const installIndex = steps?.findIndex((step) => Bun.deepEquals(step, install)) ?? -1;
  expect(installIndex).toBeGreaterThanOrEqual(0);
  expect(steps?.slice(installIndex, installIndex + 3)).toEqual([install, verify, { run: "bunx checks-flake --runs 10 --report flake-report.json" }]);
  const accepted = await repo.script(WORKFLOWS);
  expect(accepted.exitCode, accepted.text).toBe(0);

  await repo.write({ "checks.config.ts": config(false) });
  const disabled = await repo.script(WORKFLOWS, "--write");
  expect(disabled.exitCode, disabled.text).toBe(0);
  expect(await file.text()).toBe(baseline);
});

test.each([false, true])("site Nix opt-in is refused before writes when site names are held: %j", async (held) => {
  const flags = ["--pages", "acme", "--domain", "acme.example", "--production", "acme/acme.example"];
  const repo = await open({
    "package.json": JSON.stringify({ name: "acme", private: true, scripts: { test: "checks-test" } }),
    "checks.config.ts": 'export default { workflows: { setupNix: false } };\n',
  });
  if (held) {
    const written = await repo.script(WORKFLOWS, "--write", ...flags);
    expect(written.exitCode, written.text).toBe(0);
  }
  const ci = Bun.file(join(repo.dir, ".github", "workflows", "ci.yml"));
  const baseline = await ci.exists() ? await ci.text() : undefined;
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
    expect(await ci.text()).toBe(baseline);
  } else {
    expect(await ci.exists()).toBe(false);
  }
});
