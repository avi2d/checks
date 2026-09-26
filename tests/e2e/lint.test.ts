import { $ } from "bun";
import { expect, test } from "bun:test";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { withoutPullRequestEvent } from "../lib/env.ts";
import { CHECKOUT, fixtureRepos, lintWiring, ran, type FixtureRepo, type Ran } from "./lib/fixture-repo.ts";

const SCRIPT = join(CHECKOUT, "scripts", "lint.ts");
const OWNER = ["-c", "user.name=Wren Fixture", "-c", "user.email=wren@example.com"];
const STRANGER = ["-c", "user.name=stranger", "-c", "user.email=stranger@example.com"];
const open = fixtureRepos("checks-lint-");

async function commit(repo: FixtureRepo, message: string, identity: readonly string[] = OWNER): Promise<string> {
  await $`git add -A && git ${identity} commit -q --no-gpg-sign -m ${message}`.cwd(repo.dir).quiet();
  return (await $`git rev-parse HEAD`.cwd(repo.dir).quiet()).stdout.toString().trim();
}

async function repository(): Promise<{ repo: FixtureRepo; base: string }> {
  const repo = await open({ ...lintWiring(), "widget.ts": "export const widget = 42;\n" });
  const base = await commit(repo, "feat: base", ["-c", "user.name=Wren Fixture", "-c", "user.email=wren@example.com"]);
  await $`git update-ref refs/remotes/origin/main HEAD && git symbolic-ref refs/remotes/origin/HEAD refs/remotes/origin/main && git checkout -q -b feature`.cwd(repo.dir).quiet();
  return { repo, base };
}

function lint(repo: FixtureRepo, args: readonly string[] = [], env: Readonly<Record<string, string>> = {}): Promise<Ran> {
  return ran($`bun ${SCRIPT} ${args}`.cwd(repo.dir).env({ ...withoutPullRequestEvent(), PATH: `${join(CHECKOUT, "node_modules/.bin")}:${process.env["PATH"] ?? ""}`, ...env }));
}

test("the local range starts at origin/HEAD, and explicit bad refs are refused", async () => {
  const { repo, base } = await repository();
  await repo.write({ "clean.ts": "export const clean = 42;\n" });
  const head = await commit(repo, "feat: clean", ["-c", "user.name=Wren Fixture", "-c", "user.email=wren@example.com"]);
  const green = await lint(repo);
  expect(green.text).toContain(`checks-lint: range ${base}..${head} from HEAD against origin/main`);
  expect(green.text).toContain("checks-lint: 9 gate(s) pass");
  expect(green.exitCode).toBe(0);
  const missing = await lint(repo, [base, "missing"]);
  expect(missing.exitCode).toBe(2);
  expect(missing.text).toContain("missing is not a commit");
}, 60_000);

test("a pushed tip runs every range gate and names each failure", async () => {
  const { repo } = await repository();
  await $`git checkout -q main`.cwd(repo.dir).quiet();
  await repo.write({ "widget.ts": "// @ts-ignore\nexport const widget = 42;\n" });
  await writeFile(join(repo.dir, "oxlint-suppressions.json"), JSON.stringify({ "widget.ts": { "eslint/no-debugger": { count: 1 } } }));
  const tip = await commit(repo, "feat: pushed", STRANGER);
  await $`git update-ref refs/remotes/origin/main HEAD`.cwd(repo.dir).quiet();
  const red = await lint(repo);
  expect(red.text).toContain(`checks-lint: tip ${tip} from HEAD against origin/main`);
  expect(red.text).toContain("checks-commit-identity, checks-comment-gate, checks-suppressions-ratchet");
  expect(red.exitCode).toBe(1);
}, 60_000);

test("a pull request event ends the range at its head rather than the checked-out merge commit", async () => {
  const { repo, base } = await repository();
  await repo.write({ "clean.ts": "export const clean = 42;\n" });
  const head = await commit(repo, "feat: clean", ["-c", "user.name=Wren Fixture", "-c", "user.email=wren@example.com"]);
  await $`git checkout -q --detach main && git -c user.name=GitHub -c user.email=noreply@github.com merge -q --no-ff --no-gpg-sign -m merge feature`.cwd(repo.dir).quiet();
  const event = join(repo.dir, "event.json");
  await writeFile(event, JSON.stringify({ pull_request: { number: 7, base: { ref: "main" }, head: { sha: head } } }));
  const green = await lint(repo, [], { GITHUB_EVENT_NAME: "pull_request", GITHUB_EVENT_PATH: event });
  expect(green.text).toContain(`checks-lint: range ${base}..${head} from pull request #7 into main`);
  expect(green.text).toContain("checks-lint: 9 gate(s) pass");
  expect(green.exitCode).toBe(0);
}, 60_000);

test("a workflow omission makes the lint gate fail and restoring it makes it pass", async () => {
  const { repo } = await repository();
  await repo.write({ ".github/workflows/ci.yml": "on: pull_request\njobs:\n  checks:\n    runs-on: ubuntu-latest\n    steps:\n      - run: bun run lint\n" });
  await commit(repo, "chore: omit test");
  const red = await lint(repo);
  expect(red.exitCode).toBe(1);
  expect(red.text).toContain("checks-ci-wiring");
  await repo.write(lintWiring());
  await commit(repo, "fix: restore workflow");
  const green = await lint(repo);
  expect(green.exitCode).toBe(0);
}, 60_000);
