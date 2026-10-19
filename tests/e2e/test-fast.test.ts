import { $ } from "bun";
import { expect, test } from "bun:test";
import { withoutPullRequestEvent } from "../lib/env.ts";
import { CHECKOUT, fixtureRepos, ran, UNVENDORED_BUNFIG, type FixtureRepo, type Ran } from "./lib/fixture-repo.ts";

const open = fixtureRepos("checks-test-fast-");
const PASSING = 'import { expect, test } from "bun:test";\ntest("passes", () => expect(1).toBe(1));\n';

async function repository(): Promise<FixtureRepo> {
  const repo = await open({
    "package.json": JSON.stringify({ name: "test-fast-fixture", type: "module" }),
    "bunfig.toml": UNVENDORED_BUNFIG,
    "tests/unit/a.test.ts": PASSING,
  });
  await repo.commit("feat: base");
  return repo;
}

function testFast(repo: FixtureRepo): Promise<Ran> {
  return ran($`bun ${CHECKOUT}/src/testing/test-fast.ts`.cwd(repo.dir).env(withoutPullRequestEvent()));
}

test("a clone without the remote-tracking default branch fails before any tier runs", async () => {
  const repo = await repository();
  await $`git checkout -q -b feature`.cwd(repo.dir).quiet();
  await repo.write({ "tests/e2e/b.test.ts": PASSING });
  await repo.commit("test: add an e2e file");

  const refused = await testFast(repo);
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

  const fast = await testFast(repo);
  expect(fast.text).toContain("the change touches no e2e test files, so only the unit tier ran");
  expect(fast.exitCode).toBe(0);
}, 60_000);
