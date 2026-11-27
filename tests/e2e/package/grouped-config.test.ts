import { $ } from "bun";
import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { installPackedConsumer } from "../lib/consumer-install.ts";
import { CHECKOUT, fixtureRepos, ran, scratchDirs, type FixtureRepo, type Ran } from "../lib/fixture-repo.ts";

const open = fixtureRepos("checks-grouped-config-");
const scratch = scratchDirs();
const CONFIG = "checks.config.ts";
const CI_WORKFLOW = ".github/workflows/ci.yml";
const RELEASE_WORKFLOW = ".github/workflows/main.yml";
const UNIT = "tests/unit/home.test.ts";
const EXTRA = "tests/e2e/extra.test.ts";
const OTHER = "tests/e2e/other.test.ts";
const WORKFLOWS = {
  releaseAssets: true,
  platformPackages: { binary: "fixture", platforms: ["linux-x64"] },
  extraTestJobs: [{ name: "sandbox", run: "echo fixture" }],
};
const { CI: _ci, GITHUB_EVENT_NAME: _event, GITHUB_EVENT_PATH: _eventPath, GITHUB_BASE_REF: _base, AI_AGENT: _agent, CHECKS_AGENT: _checksAgent, ...localEnv } = process.env;

function config(body: string): string {
  return `const extra = ["${EXTRA}"];\nexport default ${body};\n`;
}

function fixtureTest(): string {
  return 'import { expect, test } from "bun:test";\ntest("fixture", () => expect(1).toBe(1));\n';
}

function bin(repo: FixtureRepo, name: string, ...args: readonly string[]): Promise<Ran> {
  return ran($`${join(repo.dir, "node_modules", ".bin", name)} ${args}`.cwd(repo.dir).env(localEnv));
}

async function workflows(repo: FixtureRepo): Promise<Readonly<Record<string, unknown>>> {
  const written = await bin(repo, "checks-workflows", "--write");
  expect(written.exitCode, written.text).toBe(0);
  const verified = await bin(repo, "checks-workflows");
  expect(verified.exitCode, verified.text).toBe(0);
  const paths = [...new Bun.Glob(".github/**/*.yml").scanSync({ cwd: repo.dir, dot: true })].sort();
  return Object.fromEntries(await Promise.all(paths.map(async (path) => {
    const document: unknown = Bun.YAML.parse(await readFile(join(repo.dir, path), "utf8"));
    return [path, document];
  })));
}

async function selectedLocalTests(repo: FixtureRepo): Promise<readonly string[]> {
  const run = await bin(repo, "checks-test");
  expect(run.exitCode, run.text).toBe(0);
  return [UNIT, EXTRA, OTHER].filter((path) => run.text.includes(path));
}

test("grouped settings in an installed kit do not drop configured jobs or run unselected local tests", async () => {
  const repo = await open({
    [UNIT]: fixtureTest(),
    [EXTRA]: fixtureTest(),
    [OTHER]: fixtureTest(),
  });
  const pack = await scratch("checks-grouped-config-pack-");
  await installPackedConsumer(CHECKOUT, pack, repo.dir);
  await repo.write({ "package.json": JSON.stringify({
    name: "checks-config-fixture", type: "module", scripts: { test: "checks-test", "release:assets": "echo assets" },
  }) });

  await repo.write({ [CONFIG]: config(`{ ...${JSON.stringify(WORKFLOWS)}, testTierShards: { unit: 2 }, smoke: extra }`) });
  const flat = await workflows(repo);
  expect(flat[CI_WORKFLOW]).toMatchObject({ jobs: {
    unit: { strategy: { matrix: { shard: [1, 2] } } },
    sandbox: { steps: expect.arrayContaining([expect.objectContaining({ run: "echo fixture" })]) },
  } });
  expect(flat[RELEASE_WORKFLOW]).toMatchObject({ jobs: {
    binaries: { steps: expect.arrayContaining([expect.objectContaining({ run: "bun run release:assets" })]) },
    assets: { steps: expect.arrayContaining([expect.objectContaining({ run: "bun run release:assets" })]) },
  } });
  const flatTests = await selectedLocalTests(repo);
  expect(flatTests).toEqual([UNIT, EXTRA]);

  await repo.write({ [CONFIG]: config(`{ workflows: { ...${JSON.stringify(WORKFLOWS)}, testShards: { unit: 2 } }, test: { extraLocalFiles: extra } }`) });
  expect(await workflows(repo)).toEqual(flat);
  expect(await selectedLocalTests(repo)).toEqual(flatTests);
}, 180_000);

test("a grouped private repository does not fall back to the public runner", async () => {
  const repo = await open({ [CONFIG]: 'export default { repositoryVisibility: "private" };\n' });
  const written = await repo.script("delivery/workflows.ts", "--write");
  expect(written.exitCode, written.text).toBe(0);
  const ci: unknown = Bun.YAML.parse(await readFile(join(repo.dir, CI_WORKFLOW), "utf8"));
  expect(ci).toMatchObject({ jobs: { changes: { "runs-on": "${{ vars.CI_RUNS_ON || 'ubuntu-latest' }}" } } });
  await repo.write({ [CONFIG]: 'export default { workflows: { repositoryVisibility: "private" } };\n' });
  const verified = await repo.script("delivery/workflows.ts");
  expect(verified.exitCode, verified.text).toBe(0);
});

test("a repeated grouped setting is not resolved by precedence", async () => {
  const repo = await open({ [CONFIG]: "export default { releaseAssets: false, workflows: { releaseAssets: true } };\n" });
  const run = await repo.script("delivery/workflows.ts");
  expect(run.exitCode).toBe(2);
  expect(run.text).toContain("checks.config.ts key releaseAssets and checks.config.ts key workflows.releaseAssets");
});

test("an unknown member of a known section is not silently dropped", async () => {
  const repo = await open({ [CONFIG]: "export default { test: { extraLocalFile: [] } };\n" });
  const run = await repo.script("testing/local-tests-command.ts");
  expect(run.exitCode).toBe(2);
  expect(run.text).toContain("checks.config.ts key test sets extraLocalFile, which no command reads");
});
