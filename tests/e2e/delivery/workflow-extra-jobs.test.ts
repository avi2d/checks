import { $ } from "bun";
import { expect, test } from "bun:test";
import { join } from "node:path";
import { Schema } from "effect";
import { withoutPullRequestEvent } from "../../lib/env.ts";
import { CHECKOUT, fixtureRepos, ran } from "../lib/fixture-repo.ts";

const open = fixtureRepos("checks-workflow-extra-jobs-");
const WORKFLOWS = join(CHECKOUT, "src", "delivery", "workflows.ts");
const PLAIN_STEPS = join(CHECKOUT, "src", "delivery", "plain-steps.ts");

const SANDBOX = {
  name: "sandbox",
  env: { SANDBOX_TESTS: "1", SANDBOX_TOKEN: "${{ secrets.SANDBOX_TOKEN }}" },
  setup: ["npm install --global acme-sandbox@1.2.3"],
  run: "bunx checks-test --tier=live",
};

const configWith = (jobs: readonly unknown[]): string => `export default { extraTestJobs: ${JSON.stringify(jobs)} };\n`;

const repoWith = async (config: string | undefined) => {
  const repo = await open({
    "package.json": JSON.stringify({ name: "acme", private: true }),
    "tests/e2e/one.test.ts": "export {};\n",
    ...(config === undefined ? {} : { "checks.config.ts": config }),
  });
  await repo.commit("test: declare an extra test job");
  return repo;
};

const ciOf = async (dir: string): Promise<unknown> => Bun.YAML.parse(await Bun.file(join(dir, ".github/workflows/ci.yml")).text());

const decodeSandboxCi = Schema.decodeUnknownSync(Schema.Struct({
  jobs: Schema.Struct({
    sandbox: Schema.Struct({
      steps: Schema.Array(Schema.Struct({ id: Schema.optionalKey(Schema.String), run: Schema.optionalKey(Schema.String) })),
    }),
  }),
}));

test("a declared extra test job is written with its env, setup and command, and the checks job requires it instead of leaving it out", async () => {
  const repo = await repoWith(configWith([SANDBOX]));
  const env = withoutPullRequestEvent();
  const written = await ran($`bun ${WORKFLOWS} --write`.cwd(repo.dir).env(env));
  expect(written.exitCode).toBe(0);
  expect(await ciOf(repo.dir)).toMatchObject({
    jobs: {
      sandbox: {
        needs: "changes",
        env: SANDBOX.env,
        steps: expect.arrayContaining([{ run: "npm install --global acme-sandbox@1.2.3" }, { id: "test", run: "bunx checks-test --tier=live" }]),
      },
      checks: { needs: ["changes", "static", "unit", "e2e", "sandbox"] },
    },
  });
  const reread = await ran($`bun ${WORKFLOWS}`.cwd(repo.dir).env(env));
  expect(reread.exitCode).toBe(0);
  const steps = await ran($`bun ${PLAIN_STEPS}`.cwd(repo.dir).env(env));
  expect(steps.exitCode).toBe(0);
});

test("the setup command runs before the test step in the same job instead of after it or in another job", async () => {
  const repo = await repoWith(configWith([SANDBOX]));
  const written = await ran($`bun ${WORKFLOWS} --write`.cwd(repo.dir).env(withoutPullRequestEvent()));
  expect(written.exitCode).toBe(0);
  const { jobs: { sandbox: { steps } } } = decodeSandboxCi(await ciOf(repo.dir));
  const setupIndex = steps.findIndex((step) => step.run === "npm install --global acme-sandbox@1.2.3");
  const testIndex = steps.findIndex((step) => step.id === "test");
  expect(setupIndex).toBeGreaterThan(-1);
  expect(testIndex).toBeGreaterThan(-1);
  expect(setupIndex).toBeLessThan(testIndex);
});

test("a hand-written extra test job still fails the workflow-set check instead of being kept as custom", async () => {
  const declared = await repoWith(configWith([SANDBOX]));
  const env = withoutPullRequestEvent();
  expect((await ran($`bun ${WORKFLOWS} --write`.cwd(declared.dir).env(env))).exitCode).toBe(0);
  const handWritten = await repoWith(undefined);
  await $`mkdir -p .github && cp -R ${join(declared.dir, ".github")}/. .github/`.cwd(handWritten.dir).quiet();
  const result = await ran($`bun ${WORKFLOWS}`.cwd(handWritten.dir).env(env));
  expect(result.exitCode).toBe(1);
  expect(result.text).toContain(".github/workflows/ci.yml: differs from the file checks-workflows writes");
});

test("a hand edit to a declared extra test job fails the workflow-set check instead of passing", async () => {
  const repo = await repoWith(configWith([SANDBOX]));
  const env = withoutPullRequestEvent();
  expect((await ran($`bun ${WORKFLOWS} --write`.cwd(repo.dir).env(env))).exitCode).toBe(0);
  const path = join(repo.dir, ".github/workflows/ci.yml");
  await Bun.write(path, (await Bun.file(path).text()).replace('SANDBOX_TESTS: "1"', 'SANDBOX_TESTS: "2"'));
  const result = await ran($`bun ${WORKFLOWS}`.cwd(repo.dir).env(env));
  expect(result.exitCode).toBe(1);
  expect(result.text).toContain('holds "      SANDBOX_TESTS: \\"2\\""');
});

test.each([
  ["a command list", "apt-get update && apt-get install --yes sandbox"],
  ["a command named only at run time", "${{ matrix.install }}"],
])("a setup command holding %s is refused instead of written", async (fault, command) => {
  const repo = await repoWith(configWith([{ ...SANDBOX, setup: [command] }]));
  for (const args of [[], ["--write"]]) {
    const result = await ran($`bun ${WORKFLOWS} ${args}`.cwd(repo.dir).env(withoutPullRequestEvent()));
    expect(result.exitCode).toBe(args.length === 0 ? 1 : 2);
    expect(result.text).toContain(`extraTestJobs job sandbox setup command ${JSON.stringify(command)} holds ${fault}`);
  }
});

test.each(["checks", "changes", "static", "site", "docs", "unit", "e2e", "browser"])("an extra test job named %s is refused instead of replacing the written job", async (name) => {
  const repo = await repoWith(configWith([{ ...SANDBOX, name }]));
  const result = await ran($`bun ${WORKFLOWS}`.cwd(repo.dir).env(withoutPullRequestEvent()));
  expect(result.exitCode).toBe(1);
  expect(result.text).toContain(`extraTestJobs job ${name} takes`);
});

test("two extra test jobs with one name are refused instead of the second overwriting the first", async () => {
  const repo = await repoWith(configWith([SANDBOX, { name: "sandbox", run: "bun test" }]));
  const result = await ran($`bun ${WORKFLOWS}`.cwd(repo.dir).env(withoutPullRequestEvent()));
  expect(result.exitCode).toBe(2);
  expect(result.text).toContain("names a job twice");
});
