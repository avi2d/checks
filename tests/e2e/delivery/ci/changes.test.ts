import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
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
] as const)("%s with browserRoutes=%s does not request a site build or browser walk", async (file, mapped) => {
  const repo = await open({
    "checks.config.ts": mapped ? `export default { browserRoutes: { "${file}": ["/"] } };\n` : "export default {};\n",
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
