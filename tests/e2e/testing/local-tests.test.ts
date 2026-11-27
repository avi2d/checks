import { $ } from "bun";
import { expect, test } from "bun:test";
import { mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { CHECKOUT, ran, scratchDirs, type Ran } from "../lib/fixture-repo.ts";

const scratch = scratchDirs();
const command = join(CHECKOUT, "src", "testing", "local-tests-command.ts");
const runner = join(CHECKOUT, "src", "testing", "test.ts");
const browser = join(CHECKOUT, "src", "quality", "browser", "browser.ts");
const flake = join(CHECKOUT, "src", "testing", "flake.ts");
const mutation = join(CHECKOUT, "src", "testing", "mutation.ts");
const { CI: _ci, CHECKS_AGENT: _checksAgent, AI_AGENT: _aiAgent, ...cleanEnv } = process.env;
const BLOCKED = "agent tests are blocked outside CI; set test.allowAgentRunsOutsideCI to true to allow them";

async function repository(settings?: string): Promise<string> {
  const dir = await scratch("checks-local-tests-");
  const scope = join(dir, "node_modules", "@avi2dg");
  await mkdir(scope, { recursive: true });
  await symlink(CHECKOUT, join(scope, "checks"), "dir");
  await writeFile(join(dir, "package.json"), '{"type":"module"}\n');
  await writeFile(join(dir, "bunfig.toml"), await readFile(join(CHECKOUT, "bunfig.toml")));
  if (settings !== undefined) await writeFile(join(dir, "checks.config.ts"), `export default { ${settings} };\n`);
  return dir;
}

function query(dir: string): Promise<Ran> {
  return ran($`bun ${command}`.cwd(dir).env(cleanEnv));
}

test("the query defaults to blocked instead of allowing an undeclared setting", async () => {
  const dir = await repository();
  const result = await query(dir);
  expect(result.exitCode).toBe(0);
  expect(result.text).toBe("blocked\n");
});

test("the query rejects an invalid setting instead of treating it as allowed", async () => {
  const dir = await repository('test: { allowAgentRunsOutsideCI: "true" }');
  const result = await query(dir);
  expect(result.exitCode).toBe(2);
  expect(result.text).toContain("key test.allowAgentRunsOutsideCI does not decode");
  expect(result.text).toContain('at ["allowLocal"]');
});

test("the query names the replacement key instead of honoring the old opt-in", async () => {
  const dir = await repository('localTests: "allowed"');
  const result = await query(dir);
  expect(result.exitCode).toBe(2);
  expect(result.text).toBe("checks-local-tests: checks.config.ts key localTests is no longer read; use test.allowAgentRunsOutsideCI instead\n");
});

test("an explicit false does not opt an agent in just because agentTests is present", async () => {
  const dir = await repository("test: { allowAgentRunsOutsideCI: false }");
  const result = await query(dir);
  expect(result.exitCode).toBe(0);
  expect(result.text).toBe("blocked\n");
});

test("the setting allows an agent instead of blocking all agents", async () => {
  const dir = await repository("test: { allowAgentRunsOutsideCI: true }");
  const result = await query(dir);
  expect(result.exitCode).toBe(0);
  expect(result.text).toBe("allowed\n");
  const guard = await ran($`bun --preload @avi2dg/checks/local-test-preload -e ${'console.log("started")'}`.cwd(dir).env({ ...cleanEnv, CHECKS_AGENT: "1" }));
  expect(guard.exitCode).toBe(0);
  expect(guard.text).toBe("started\n");
});

test("a flat opt-in does not put its deprecation note on stdout", async () => {
  const dir = await repository("agentTests: { allowLocal: true }");
  const result = await $`bun ${command}`.cwd(dir).env(cleanEnv).nothrow().quiet();
  expect(result.exitCode).toBe(0);
  expect(result.stdout.toString()).toBe("allowed\n");
  expect(result.stderr.toString()).toContain("checks.config.ts key agentTests.allowLocal is deprecated; move it to test.allowAgentRunsOutsideCI");
});

test("the guarded entry points refuse before starting a local agent test", async () => {
  const dir = await repository();
  const env = { ...cleanEnv, CHECKS_AGENT: "1" };
  await writeFile(join(dir, "sample.test.ts"), 'import { test } from "bun:test";\ntest("starts", () => { console.log("test started"); });\n');
  const bun = await ran($`bun test sample.test.ts`.cwd(dir).env(env));
  const entry = await ran($`bun ${runner} --invalid`.cwd(dir).env(env));
  const site = await ran($`bun ${browser} .`.cwd(dir).env(env));
  const flaky = await ran($`bun ${flake}`.cwd(dir).env(env));
  const mutate = await ran($`bun ${mutation} --mutate src/x.ts`.cwd(dir).env(env));
  for (const result of [bun, entry, site, flaky]) {
    expect(result.exitCode).not.toBe(0);
    expect(result.text).toContain(BLOCKED);
    expect(result.text).not.toContain("test started");
  }
  expect(mutate.exitCode).toBe(2);
  expect(mutate.text).toContain(BLOCKED);
});

test("a non-empty AI_AGENT alone blocks the runner and preload instead of requiring CHECKS_AGENT", async () => {
  const dir = await repository();
  const env = { ...cleanEnv, AI_AGENT: "editor" };
  const entry = await ran($`bun ${runner} --invalid`.cwd(dir).env(env));
  const preload = await ran($`bun --preload @avi2dg/checks/local-test-preload -e ${'console.log("started")'}`.cwd(dir).env(env));
  expect(entry.exitCode).toBe(2);
  expect(entry.text).toContain(BLOCKED);
  expect(preload.exitCode).toBe(1);
  expect(preload.text).not.toContain("started");
  expect(preload.text).toContain(BLOCKED);
});

test("the preload lets CI and an empty AI_AGENT through rather than treating either as a local agent", async () => {
  const dir = await repository();
  await writeFile(join(dir, "sample.test.ts"), 'import { test } from "bun:test";\ntest("starts", () => { console.log("test started"); });\n');
  for (const env of [cleanEnv, { ...cleanEnv, AI_AGENT: "" }, { ...cleanEnv, AI_AGENT: "editor", CHECKS_AGENT: "1", CI: "true" }]) {
    const result = await ran($`bun test sample.test.ts`.cwd(dir).env(env));
    expect(result.exitCode).toBe(0);
    expect(result.text).toContain("test started");
  }
});
