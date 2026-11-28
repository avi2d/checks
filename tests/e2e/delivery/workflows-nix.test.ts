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
