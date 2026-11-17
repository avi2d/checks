import { $ } from "bun";
import { expect, test } from "bun:test";
import { mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { CHECKOUT, ran, scratchDirs, type Ran } from "../lib/fixture-repo.ts";

const scratch = scratchDirs();
const command = join(CHECKOUT, "src", "testing", "local-tests-command.ts");
const runner = join(CHECKOUT, "src", "testing", "test.ts");
const browser = join(CHECKOUT, "src", "quality", "browser", "browser.ts");
const { CI: _ci, CHECKS_AGENT: _agent, ...cleanEnv } = process.env;

async function repository(config?: string): Promise<string> {
  const dir = await scratch("checks-local-tests-");
  const scope = join(dir, "node_modules", "@avi2dg");
  await mkdir(scope, { recursive: true });
  await symlink(CHECKOUT, join(scope, "checks"), "dir");
  await writeFile(join(dir, "package.json"), '{"type":"module"}\n');
  await writeFile(join(dir, "bunfig.toml"), await readFile(join(CHECKOUT, "bunfig.toml")));
  if (config !== undefined) await writeFile(join(dir, "checks.config.ts"), `export default { localTests: ${config} };\n`);
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
  const dir = await repository('"other"');
  const result = await query(dir);
  expect(result.exitCode).toBe(2);
  expect(result.text).toContain("localTests");
});

test("the setting allows an agent instead of blocking all agents", async () => {
  const dir = await repository('"allowed"');
  const result = await query(dir);
  expect(result.exitCode).toBe(0);
  expect(result.text).toBe("allowed\n");
  const guard = await ran($`bun --preload @avi2dg/checks/local-test-preload -e ${'console.log("started")'}`.cwd(dir).env({ ...cleanEnv, CHECKS_AGENT: "1" }));
  expect(guard.exitCode).toBe(0);
  expect(guard.text).toBe("started\n");
});

test("the guarded entry points refuse before starting a local agent test", async () => {
  const dir = await repository();
  const env = { ...cleanEnv, CHECKS_AGENT: "1" };
  await writeFile(join(dir, "sample.test.ts"), 'import { test } from "bun:test";\ntest("starts", () => { console.log("test started"); });\n');
  const bun = await ran($`bun test sample.test.ts`.cwd(dir).env(env));
  const entry = await ran($`bun ${runner} --invalid`.cwd(dir).env(env));
  const site = await ran($`bun ${browser} .`.cwd(dir).env(env));
  for (const result of [bun, entry, site]) {
    expect(result.exitCode).not.toBe(0);
    expect(result.text).toContain("checks.config.ts localTests is blocked");
    expect(result.text).not.toContain("test started");
  }
});

test("the preload does not block a person or CI", async () => {
  const dir = await repository();
  await writeFile(join(dir, "sample.test.ts"), 'import { test } from "bun:test";\ntest("starts", () => { console.log("test started"); });\n');
  for (const env of [cleanEnv, { ...cleanEnv, CHECKS_AGENT: "1", CI: "true" }]) {
    const result = await ran($`bun test sample.test.ts`.cwd(dir).env(env));
    expect(result.exitCode).toBe(0);
    expect(result.text).toContain("test started");
  }
});
