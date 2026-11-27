import { $ } from "bun";
import { expect, test } from "bun:test";
import { join } from "node:path";
import { withoutPullRequestEvent } from "../../lib/env.ts";
import { CHECKOUT, fixtureRepos, ran } from "../lib/fixture-repo.ts";

const open = fixtureRepos("checks-workflow-shards-");
const SCRIPT = join(CHECKOUT, "src", "delivery", "workflows.ts");

for (const tier of ["unit", "e2e"] as const) {
  for (const kind of ["code", "site"] as const) {
    for (const run of [undefined, `bunx checks-test --pr --parallel=4 --tier=${tier}`, `bun run test --pr --tier=${tier}`]) {
      test(`${kind} workflows refuse testTierShards.${tier} without a default job instead of silently ignoring it (${run ?? "missing"})`, async () => {
        const repo = await open({
          "package.json": JSON.stringify({ name: "acme", private: true }),
          "checks.config.ts": `export default { testTierShards: { ${tier}: 2 } };\n`,
          ...(run === undefined ? {} : { "tests/e2e/one.test.ts": "export {};\n" }),
          ".github/workflows/ci.yml": Bun.YAML.stringify({
            name: "ci",
            on: "pull_request",
            ...(kind === "site" ? { env: { SITE_PAGES: "acme", SITE_DOMAIN: "acme.example", SITE_PRODUCTION: "acme/acme.example" } } : {}),
            jobs: { custom: { "runs-on": "ubuntu-latest", steps: [{ id: "test", run: run ?? (tier === "unit" ? "echo custom" : "bunx checks-test --pr --tier=unit") }] } },
          }),
        });
        await repo.commit("test: configure an unavailable shard tier");
        for (const args of [[], ["--write"]]) {
          const result = await ran($`bun ${SCRIPT} ${args}`.cwd(repo.dir).env(withoutPullRequestEvent()));
          expect(result.exitCode).toBe(args.length === 0 ? 1 : 2);
          expect(result.text).toContain(`testTierShards.${tier}`);
          expect(result.text).toContain(`no default ${tier} test job`);
        }
      });
    }
  }
}

test.each([false, true])("default tier shards survive a write and reread instead of being refused as custom commands, with release checks %s", async (releaseChecks) => {
  const repo = await open({
    "package.json": JSON.stringify({ name: "acme", private: true, ...(releaseChecks ? { scripts: { test: "checks-test" } } : {}) }),
    "checks.config.ts": "export default { testTierShards: { unit: 2, e2e: 2 } };\n",
    "tests/e2e/one.test.ts": "export {};\n",
  });
  await repo.commit("test: configure default tier shards");
  const env = withoutPullRequestEvent();
  const written = await ran($`bun ${SCRIPT} --write`.cwd(repo.dir).env(env));
  expect(written.exitCode).toBe(0);
  const document: unknown = Bun.YAML.parse(await Bun.file(join(repo.dir, ".github/workflows/ci.yml")).text());
  expect(document).toMatchObject({
    jobs: {
      unit: { strategy: { "fail-fast": false, matrix: { shard: [1, 2] } } },
      e2e: { strategy: { "fail-fast": false, matrix: { shard: [1, 2] } } },
      checks: { needs: ["changes", "static", "unit", "e2e"] },
    },
  });
  const reread = await ran($`bun ${SCRIPT}`.cwd(repo.dir).env(env));
  expect(reread.exitCode).toBe(0);
});

const MUTATION_PATH = ".github/workflows/mutation.yml";
const WIRING = join(CHECKOUT, "src", "delivery", "ci-wiring.ts");

test.each([
  { config: {}, count: "12" },
  { config: { mutationShardCount: 4 }, count: "4" },
])("the mutation workflow writes $count shards instead of losing the setting or cancelling sibling shards", async ({ config, count }) => {
  const repo = await open({
    "package.json": JSON.stringify({ name: "acme", private: true }),
    "checks.config.ts": `export default ${JSON.stringify(config)};\n`,
    ".bun-version": await Bun.file(join(CHECKOUT, ".bun-version")).text(),
    "CHANGELOG.md": "# Changelog\n",
  });
  await repo.commit("test: configure a mutation refresh");
  const env = withoutPullRequestEvent();
  const written = await ran($`bun ${SCRIPT} --write`.cwd(repo.dir).env(env));
  expect(written.exitCode).toBe(0);
  const document: unknown = Bun.YAML.parse(await Bun.file(join(repo.dir, MUTATION_PATH)).text());
  expect(document).toMatchObject({
    jobs: {
      "refresh-plan": { steps: expect.arrayContaining([expect.objectContaining({ id: "shards", env: { SHARDS: count } })]) },
      "refresh-shard": { strategy: { "fail-fast": false, "max-parallel": 4 } },
    },
  });
  expect((await ran($`bun ${WIRING}`.cwd(repo.dir).env(env))).exitCode).toBe(0);
});

test.each([0, -1, 1.5, "4", 257])("workflow generation refuses mutationShardCount %j instead of writing an invalid matrix", async (count) => {
  const repo = await open({ "checks.config.ts": `export default { mutationShardCount: ${JSON.stringify(count)} };\n` });
  const result = await ran($`bun ${SCRIPT} --write`.cwd(repo.dir).env(withoutPullRequestEvent()));
  expect(result.exitCode).toBe(2);
  expect(result.text).toContain("checks.config.ts key mutationShardCount does not decode");
  expect(await Bun.file(join(repo.dir, MUTATION_PATH)).exists()).toBe(false);
});
