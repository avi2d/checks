import { $ } from "bun";
import { expect, test } from "bun:test";
import { join } from "node:path";
import { CHECKOUT, fixtureRepos, UNVENDORED_BUNFIG } from "../lib/fixture-repo.ts";

const open = fixtureRepos("checks-settings-diagnostics-");
const CONFIG = "checks.config.ts";
const UNIT = "tests/unit/home.test.ts";
const EXTRA = "tests/e2e/extra.test.ts";
const OTHER = "tests/e2e/other.test.ts";
const PASSING = 'import { expect, test } from "bun:test";\ntest("passes", () => expect(1).toBe(1));\n';
const { CI: _ci, GITHUB_EVENT_NAME: _event, GITHUB_EVENT_PATH: _eventPath, GITHUB_BASE_REF: _base, CHECKS_AGENT: _checksAgent, AI_AGENT: _agent, ...localEnv } = process.env;
const REACH_NOTE = "checks.config.ts key reach is deprecated; move it to test.affected";
const TIMEOUT_NOTE = "checks.config.ts key testFileMaxSeconds is deprecated; move it to test.fileTimeoutSeconds";
const AGENT_NOTE = "checks.config.ts key agentTests.allowLocal is deprecated; move it to test.allowAgentRunsOutsideCI";

test.each(["flat", "grouped"] as const)("a pull request with %s settings emits neither duplicate current notes nor false historical notes", async (shape) => {
  const before = { "src/page.astro": [UNIT] };
  const after = { "src/page.astro": [UNIT, EXTRA] };
  const repo = await open({
    "package.json": JSON.stringify({ name: "settings-diagnostics-fixture", type: "module" }),
    "bunfig.toml": UNVENDORED_BUNFIG,
    [CONFIG]: `export default { reach: ${JSON.stringify(before)}, testFileMaxSeconds: 120, agentTests: { allowLocal: true } };\n`,
    [UNIT]: PASSING,
    [EXTRA]: PASSING,
    [OTHER]: 'import { expect, test } from "bun:test";\ntest("unselected", () => expect(1).toBe(2));\n',
  });
  await repo.commit("test: base with flat settings");
  await $`git update-ref refs/remotes/origin/main HEAD && git symbolic-ref refs/remotes/origin/HEAD refs/remotes/origin/main && git checkout -q -b feature`.cwd(repo.dir).quiet();
  await repo.write({
    [CONFIG]: shape === "flat"
      ? `export default { reach: ${JSON.stringify(after)}, testFileMaxSeconds: 120, agentTests: { allowLocal: true } };\n`
      : `export default { test: { affected: ${JSON.stringify(after)}, fileTimeoutSeconds: 120, allowAgentRunsOutsideCI: true } };\n`,
  });
  const sha = await repo.commit("test: extend the affected test map");
  await repo.write({ "event.json": JSON.stringify({ pull_request: { number: 1, title: "test settings", base: { ref: "main" }, head: { sha } } }) });
  const env = { ...localEnv, CI: "true", GITHUB_EVENT_NAME: "pull_request", GITHUB_EVENT_PATH: join(repo.dir, "event.json") };
  const result = await $`bun ${join(CHECKOUT, "src/testing/test.ts")} --pr --parallel=1`.cwd(repo.dir).env(env).nothrow().quiet();
  const stdout = result.stdout.toString();
  const stderr = result.stderr.toString();
  expect(result.exitCode, stdout + stderr).toBe(0);
  expect(stdout).toContain("the pull request reaches 2 of 3 test file(s)");
  expect(stderr).toContain("2 pass");
  expect(stdout).not.toContain("is deprecated");
  expect(stderr.split("\n").filter((line) => line.includes(" is deprecated;"))).toEqual(shape === "flat" ? [REACH_NOTE, AGENT_NOTE, TIMEOUT_NOTE] : []);
}, 60_000);

test("unknown root key advice does not recommend deprecated flat keys", async () => {
  const repo = await open({ [CONFIG]: "export default { typo: true };\n" });
  const result = await repo.script("testing/local-tests-command.ts");
  expect(result.exitCode).toBe(2);
  expect(result.text).toBe("checks-local-tests: checks.config.ts sets typo, which no command reads; its keys are workflows, test, copy, frontendSyntax, commentGate, lintCoverage, browser, browserRoutes, browserBuild, browserTimings\n");
});
