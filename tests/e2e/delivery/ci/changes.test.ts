import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import browserPlan from "../../../../src/quality/browser/browser-checks.json" with { type: "json" };
import { runCi } from "../../lib/ci-command.ts";
import { fixtureRepos } from "../../lib/fixture-repo.ts";

const open = fixtureRepos("checks-ci-changes-");

test.each([
  ["tests/unit/home.test.ts", false],
  ["tests/e2e/home.test.ts", false],
  ["tests/unit/helper.ts", false],
  ["tests/e2e/helper.tsx", false],
  ["tests/unit/home.test.ts", true],
  ["tests/e2e/home.test.ts", true],
  ["tests/unit/helper.ts", true],
  ["tests/e2e/helper.tsx", true],
] as const)("%s with affectedRoutes=%s does not request a site build or browser walk", async (file, mapped) => {
  const repo = await open({
    ...(mapped ? { "checks.browser.config.ts": `export default ${JSON.stringify({ ...browserPlan, affectedRoutes: { [file]: ["/"] } })};\n` } : {}),
    [file]: "export {};\n",
  });
  const base = await repo.commit("test: base");
  await repo.write({ [file]: "export {};\n\n" });
  await repo.commit("test: change only tests");
  const output = join(repo.dir, "output");
  const result = await runCi("changes", [], {
    PATH: process.env["PATH"] ?? "",
    BASE_SHA: base,
    PLAN_BROWSER: "true",
    GITHUB_OUTPUT: output,
  }, repo.dir);
  expect(result.exitCode).toBe(0);
  expect(Object.fromEntries((await readFile(output, "utf8")).trim().split("\n").map((line) => line.split("=")))).toEqual({
    "docs-only": "false",
    "tests-only": "true",
    browser: "false",
  });
});

test("editing only the browser config does not narrow to the routes in its own map", async () => {
  const file = "checks.browser.config.ts";
  const repo = await open({ [file]: `export default ${JSON.stringify({ ...browserPlan, affectedRoutes: {} })};\n` });
  const base = await repo.commit("test: record the browser config");
  await repo.write({ [file]: `export default ${JSON.stringify({ ...browserPlan, affectedRoutes: { [file]: [] } })};\n` });
  await repo.commit("test: change the browser config only");
  const output = join(repo.dir, "output");
  const result = await runCi("changes", [], {
    PATH: process.env["PATH"] ?? "",
    BASE_SHA: base,
    PLAN_BROWSER: "true",
    GITHUB_OUTPUT: output,
  }, repo.dir);
  expect(result.exitCode).toBe(0);
  expect((await readFile(output, "utf8")).trim().split("\n")).toEqual(["docs-only=false", "tests-only=false", "browser=true"]);
});

test.each([
  ["map only", { test: { affected: { "src/home.ts": ["tests/e2e/other.test.ts"] } } }, "true", "false"],
  ["general settings", { test: { affected: { "src/home.ts": ["tests/e2e/other.test.ts"] }, fileTimeoutSeconds: 90 } }, "false", "true"],
] as const)("a %s edit is not mistaken for the other kind of config change", async (_name, settings, testsOnly, browser) => {
  const file = "checks.config.ts";
  const repo = await open({ [file]: 'export default { reach: { "src/home.ts": ["tests/e2e/home.test.ts"] } };\n' });
  const base = await repo.commit("test: record flat reach map");
  await repo.write({ [file]: `export default ${JSON.stringify(settings)};\n` });
  await repo.commit("test: change grouped settings");
  const output = join(repo.dir, "output");
  const result = await runCi("changes", [], {
    PATH: process.env["PATH"] ?? "",
    BASE_SHA: base,
    PLAN_BROWSER: "true",
    GITHUB_OUTPUT: output,
  }, repo.dir);
  expect(result.exitCode).toBe(0);
  expect((await readFile(output, "utf8")).trim().split("\n")).toEqual(["docs-only=false", `tests-only=${testsOnly}`, `browser=${browser}`]);
});
