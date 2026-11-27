import { $ } from "bun";
import { expect, test } from "bun:test";
import { mkdir, symlink } from "node:fs/promises";
import { join } from "node:path";
import { withoutPullRequestEvent } from "../../lib/env.ts";
import { CHECKOUT, fixtureRepos, ran, type Ran } from "../lib/fixture-repo.ts";

const open = fixtureRepos("checks-platform-skips-");
const SCRIPT = join(CHECKOUT, "src", "testing", "test.ts");

async function checkSkip(condition: string, scope: string): Promise<Ran> {
  const repo = await open({
    "package.json": JSON.stringify({ name: "consumer", scripts: { test: "checks-test" } }),
    "tests/e2e/fixture.test.ts": `import { test } from "bun:test";
import { skipReason } from "@avi2dg/checks/scripts/test-skips.ts";
test.skipIf(${condition})(skipReason("the fixture is unavailable", "loads the fixture", ${scope}), () => {});
`,
  });
  const packages = join(repo.dir, "node_modules", "@avi2dg");
  await mkdir(packages, { recursive: true });
  await symlink(CHECKOUT, join(packages, "checks"), "dir");
  return ran($`bun ${SCRIPT} --tier=e2e --parallel=1`.cwd(repo.dir).env({ ...withoutPullRequestEvent(), CI: "true" }));
}

test("a skip declared for another platform does not cover a skip on this host", async () => {
  const other = process.platform === "darwin" ? "linux" : "darwin";
  const refused = await checkSkip("true", `undefined, "${other}"`);
  expect(refused.exitCode).toBe(1);
  expect(refused.text).toContain("loads the fixture: skipped with no reason at its test site");
});

test("a Linux-only skip declaration neither fails the skip on Linux nor flags a pass on other hosts", async () => {
  const result = await checkSkip('process.platform === "linux"', '"ci", "linux"');
  expect(result.exitCode).toBe(0);
  expect(result.text).toContain(process.platform === "linux"
    ? "1 skipped test(s), each declared at its test site"
    : "1 declaration(s) for another platform not judged in this ci run");
});

test("an invalid platform is not accepted as a skip declaration", async () => {
  const refused = await checkSkip("true", '"ci", "macos"');
  expect(refused.exitCode).toBe(2);
  expect(refused.text).toContain("skipReason's platform must be a literal");
});
