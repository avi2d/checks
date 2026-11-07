import { $ } from "bun";
import { expect, test } from "bun:test";
import { join } from "node:path";
import { withoutPullRequestEvent } from "../lib/env.ts";
import { CHECKOUT, fixtureRepos, ran, UNVENDORED_BUNFIG, type FixtureRepo, type Ran } from "./lib/fixture-repo.ts";

const open = fixtureRepos("checks-test-changed-");
const PASSING = 'import { expect, test } from "bun:test";\ntest("passes", () => expect(1).toBe(1));\n';
const FAILING = 'import { expect, test } from "bun:test";\ntest("fails", () => expect(1).toBe(2));\n';

async function repository(): Promise<FixtureRepo> {
  const repo = await open({
    "package.json": JSON.stringify({ name: "test-changed-fixture", type: "module" }),
    "bunfig.toml": UNVENDORED_BUNFIG,
    "tests/unit/a.test.ts": PASSING,
  });
  await repo.commit("feat: base");
  return repo;
}

async function branchedFromOrigin(repo: FixtureRepo): Promise<void> {
  await $`git update-ref refs/remotes/origin/main HEAD && git symbolic-ref refs/remotes/origin/HEAD refs/remotes/origin/main && git checkout -q -b feature`.cwd(repo.dir).quiet();
}

function testChanged(repo: FixtureRepo): Promise<Ran> {
  const { CI: _ci, ...env } = withoutPullRequestEvent();
  return ran($`bun ${join(CHECKOUT, "src", "testing", "test.ts")} --changed`.cwd(repo.dir).env(env));
}

test("a clone without the remote-tracking default branch fails before any tier runs", async () => {
  const repo = await repository();
  await $`git checkout -q -b feature`.cwd(repo.dir).quiet();
  await repo.write({ "tests/e2e/b.test.ts": PASSING });
  await repo.commit("test: add an e2e file");

  const refused = await testChanged(repo);
  expect(refused.exitCode).toBe(2);
  expect(refused.text).toContain("cannot find where HEAD branched from origin/main");
  expect(refused.text).not.toContain("1 pass");
}, 60_000);

test("a stale local default branch does not pull in e2e files origin already holds", async () => {
  const repo = await repository();
  await repo.write({ "tests/e2e/b.test.ts": PASSING });
  await repo.commit("test: add an e2e file");
  await $`git update-ref refs/remotes/origin/main HEAD && git symbolic-ref refs/remotes/origin/HEAD refs/remotes/origin/main && git reset -q --hard HEAD~1 && git checkout -q -b feature origin/main`.cwd(repo.dir).quiet();
  await repo.write({ "tests/unit/c.test.ts": PASSING });
  await repo.commit("test: add a unit file");

  const fast = await testChanged(repo);
  expect(fast.text).toContain("the change touches no e2e test files, so only the unit tier runs");
  expect(fast.text).toContain("2 pass");
  expect(fast.exitCode).toBe(0);
}, 60_000);

test("a committed, an edited and an untracked e2e file run beside the unit tier while an untouched e2e file stays out", async () => {
  const repo = await repository();
  await repo.write({ "tests/e2e/edited.test.ts": PASSING, "tests/e2e/untouched.test.ts": FAILING });
  await repo.commit("test: add e2e files");
  await branchedFromOrigin(repo);
  await repo.write({ "tests/e2e/committed.test.ts": PASSING });
  await repo.commit("test: add a committed e2e file");
  await repo.write({ "tests/e2e/edited.test.ts": PASSING + "test(\"also passes\", () => expect(2).toBe(2));\n", "tests/e2e/untracked.test.ts": PASSING });

  const fast = await testChanged(repo);
  expect(fast.text).toContain("the change touches 3 e2e test file(s): tests/e2e/committed.test.ts tests/e2e/edited.test.ts tests/e2e/untracked.test.ts");
  expect(fast.text).toContain("5 pass");
  expect(fast.text).toContain("0 fail");
  expect(fast.exitCode).toBe(0);
}, 60_000);

test("a skip without a reason in a touched e2e file fails the run, rather than passing because bun test exits zero on a skip", async () => {
  const repo = await repository();
  await branchedFromOrigin(repo);
  await repo.write({ "tests/e2e/skipped.test.ts": 'import { test } from "bun:test";\ntest.skip("waits", () => {});\n' });

  const fast = await testChanged(repo);
  expect(fast.text).toContain("checks-test: 1 skipped test(s) undeclared in this local run:");
  expect(fast.text).toContain("tests/e2e/skipped.test.ts:2 waits");
  expect(fast.exitCode).toBe(1);
}, 60_000);
