import { $ } from "bun";
import { expect, test } from "bun:test";
import { unlink } from "node:fs/promises";
import { join } from "node:path";
import { withoutPullRequestEvent } from "../../lib/env.ts";
import { installPackedConsumer } from "../lib/consumer-install.ts";
import { CHECKOUT, fixtureRepos, ran, scratchDirs, type FixtureRepo } from "../lib/fixture-repo.ts";

const open = fixtureRepos("checks-browser-config-");
const scratch = scratchDirs();
const SHARED = "checks.config.ts";
const BROWSER = "checks.browser.config.ts";
const HOME = "src/home.ts";
const PAGE = '<!doctype html><html lang="en"><title>Fixture</title><main><h1>Fixture</h1></main></html>\n';
const PLAN = {
  site: "site",
  routes: [{ path: "/", locale: "en" }, { path: "/other/", locale: "en" }],
  viewports: [{ name: "wide", width: 800, height: 600 }],
  states: [{ name: "default" }],
  targets: [{ name: "headline", selector: "main h1" }],
  checks: ["layout"],
};
const AFFECTED = { [HOME]: ["/"] };

async function recordPullRequest(repo: FixtureRepo): Promise<string> {
  const base = await repo.commit("test: record the two routes");
  await $`git update-ref refs/remotes/origin/main ${base} && git switch -qc feature`.cwd(repo.dir).quiet();
  await repo.write({ [HOME]: "export const home = 2;\n" });
  const head = await repo.commit("test: edit only the home source");
  await repo.write({ "event.json": JSON.stringify({ pull_request: { number: 1, base: { ref: "main" }, head: { sha: head } } }) });
  return join(repo.dir, "event.json");
}

async function browser(repo: FixtureRepo, event: string) {
  const bin = join(repo.dir, "node_modules", ".bin", "checks-browser");
  const result = await $`${bin} --pr --shard=2/2`.cwd(repo.dir).env({
    ...withoutPullRequestEvent(), CI: "true", GITHUB_EVENT_NAME: "pull_request", GITHUB_EVENT_PATH: event,
  }).nothrow().quiet();
  const stdout = result.stdout.toString();
  const stderr = result.stderr.toString();
  expect(result.exitCode, stdout + stderr).toBe(0);
  return { stdout, stderr };
}

test("moving options before or with the packed browser plan does not hide the plan or widen the walk", async () => {
  const repo = await open({
    ".gitignore": "node_modules/\n",
    [HOME]: "export const home = 1;\n",
    "site/index.html": PAGE,
    "site/other/index.html": PAGE,
  });
  const pack = await scratch("checks-browser-config-pack-");
  await installPackedConsumer(CHECKOUT, pack, repo.dir);
  const event = await recordPullRequest(repo);

  await repo.write({ [SHARED]: `export default ${JSON.stringify({ browser: PLAN, browserRoutes: AFFECTED })};\n` });
  const legacy = await browser(repo, event);
  expect(legacy.stdout).toContain("browser: src/home.ts -> /\n");
  expect(legacy.stdout).toContain("browser: the pull request reaches 1 of 2 route(s)");
  expect(legacy.stdout).toContain("browser: shard 2 of 2 checks no route");
  expect(legacy.stdout).not.toContain("is deprecated");
  expect(legacy.stderr.trim().split("\n")).toEqual([
    "checks.config.ts key browser is deprecated; move it to checks.browser.config.ts",
    "checks.config.ts key browserRoutes is deprecated; move it to checks.browser.config.ts key affectedRoutes",
  ]);

  await repo.write({ [BROWSER]: 'export default { timingsMs: { "/": { layout: 1 } } };\n' });
  const mixed = await browser(repo, event);
  expect(mixed.stdout).toBe(legacy.stdout);
  expect(mixed.stderr).toBe(legacy.stderr);

  await unlink(join(repo.dir, SHARED));
  await repo.write({
    [SHARED]: 'import { defineConfig } from "@avi2dg/checks/config";\nexport default defineConfig({ workflows: { releaseAssets: false } });\n',
    [BROWSER]: `import { defineBrowserConfig } from "@avi2dg/checks/browser-config";\nexport default defineBrowserConfig(${JSON.stringify({ ...PLAN, affectedRoutes: AFFECTED })});\n`,
    "tsconfig.json": JSON.stringify({
      compilerOptions: { target: "esnext", module: "preserve", moduleResolution: "bundler", strict: true, noEmit: true, skipLibCheck: true, allowImportingTsExtensions: true },
      files: [SHARED, BROWSER],
    }),
  });
  const tsc = join(CHECKOUT, "node_modules", ".bin", "tsc");
  const types = await ran($`${tsc}`.cwd(repo.dir));
  expect(types.exitCode, types.text).toBe(0);
  const migrated = await browser(repo, event);
  expect(migrated.stdout).toBe(legacy.stdout);
  expect(migrated.stderr).toBe("");
}, 180_000);

test("workflow generation does not import the separate browser config", async () => {
  const repo = await open({ [BROWSER]: 'throw new Error("browser config must stay out of workflows");\n' });
  const generated = await repo.script("delivery/workflows.ts", "--write");
  expect(generated.exitCode, generated.text).toBe(0);
  const verified = await repo.script("delivery/workflows.ts");
  expect(verified.exitCode, verified.text).toBe(0);
});

test.each([
  [{ browser: PLAN }, PLAN, "checks.config.ts key browser and checks.browser.config.ts set the same setting"],
  [{ browserRoutes: AFFECTED }, { ...PLAN, affectedRoutes: AFFECTED }, "checks.config.ts key browserRoutes and checks.browser.config.ts key affectedRoutes set the same setting"],
] as const)("the browser command does not accept duplicate settings: %s", async (shared, browserConfig, diagnostic) => {
  const repo = await open({
    [SHARED]: `export default ${JSON.stringify(shared)};\n`,
    [BROWSER]: `export default ${JSON.stringify(browserConfig)};\n`,
  });
  const run = await repo.script("quality/browser/browser.ts");
  expect(run.exitCode, run.text).toBe(2);
  expect(run.text).toContain(diagnostic);
});

test.each([
  [{ site: "site" }, "checks.browser.config.ts does not decode", '["routes"]'],
  [{ ...PLAN, routesBySource: {} }, "checks.browser.config.ts sets routesBySource, which no command reads", "affectedRoutes"],
] as const)("the browser command does not ignore a missing or unknown field: %s", async (browserConfig, diagnostic, field) => {
  const repo = await open({ [BROWSER]: `export default ${JSON.stringify(browserConfig)};\n` });
  const run = await repo.script("quality/browser/browser.ts");
  expect(run.exitCode, run.text).toBe(2);
  expect(run.text).toContain(diagnostic);
  expect(run.text).toContain(field);
});
