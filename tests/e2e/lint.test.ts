import { $ } from "bun";
import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { withoutPullRequestEvent } from "../lib/env.ts";

const CHECKOUT = resolve(import.meta.dir, "..", "..");
const SCRIPT = join(CHECKOUT, "scripts", "lint.ts");
const OWNER = ["-c", "user.name=avi2d", "-c", "user.email=avi2dg@gmail.com"];
const STRANGER = ["-c", "user.name=stranger", "-c", "user.email=stranger@example.com"];

const LOCAL_ENV = {
  ...withoutPullRequestEvent(),
  PATH: `${join(CHECKOUT, "node_modules", ".bin")}:${process.env["PATH"] ?? ""}`,
};

let dir = "";

afterEach(async () => {
  if (dir !== "") {
    await rm(dir, { recursive: true, force: true });
    dir = "";
  }
});

async function commit(message: string, identity: readonly string[] = OWNER): Promise<string> {
  await $`git add -A && git ${identity} commit -q --no-gpg-sign -m ${message}`.cwd(dir).quiet();
  return (await $`git rev-parse HEAD`.cwd(dir).quiet()).stdout.toString().trim();
}

async function suppressions(count: number): Promise<void> {
  await writeFile(
    join(dir, "oxlint-suppressions.json"),
    JSON.stringify({ "widget.ts": { "eslint/no-debugger": { count } } }),
  );
}

async function initRepo(manifest: Record<string, unknown> = {}): Promise<string> {
  dir = await mkdtemp(join(tmpdir(), "checks-lint-"));
  await writeFile(
    join(dir, "package.json"),
    JSON.stringify({
      name: "checks-lint-fixture",
      type: "module",
      scripts: { lint: "checks-lint", test: "bun test --randomize" },
      ciWiring: { gates: ["bun run lint"] },
      ...manifest,
    }),
  );
  await writeFile(join(dir, "bunfig.toml"), await readFile(join(CHECKOUT, "bunfig.toml"), "utf8"));
  await mkdir(join(dir, ".github", "workflows"), { recursive: true });
  await writeFile(
    join(dir, ".github", "workflows", "ci.yml"),
    "on: pull_request\njobs:\n  lint:\n    runs-on: ubuntu-latest\n    steps:\n      - run: bun run lint\n",
  );
  await writeFile(join(dir, "widget.ts"), "export const widget = 42;\n");
  await suppressions(2);
  await $`git init -q -b main`.cwd(dir).quiet();
  const base = await commit("feat: base");
  await $`git update-ref refs/remotes/origin/main HEAD`.cwd(dir).quiet();
  await $`git symbolic-ref refs/remotes/origin/HEAD refs/remotes/origin/main`.cwd(dir).quiet();
  await $`git checkout -q -b feature`.cwd(dir).quiet();
  return base;
}

async function lint(
  args: readonly string[] = [],
  env: Readonly<Record<string, string>> = {},
): Promise<{ exitCode: number; text: string }> {
  const result = await $`bun ${SCRIPT} ${args}`
    .cwd(dir)
    .env({ ...LOCAL_ENV, ...env })
    .nothrow()
    .quiet();
  return { exitCode: result.exitCode, text: result.stdout.toString() + result.stderr.toString() };
}

test(
  "the range starts where HEAD branched from origin/HEAD, then origin/main, unless arguments name it",
  async () => {
    const base = await initRepo();
    await writeFile(join(dir, "clean.ts"), "export const answer = 42;\n");
    const head = await commit("feat: clean");
    await $`git update-ref refs/remotes/origin/trunk ${base}`.cwd(dir).quiet();
    await $`git symbolic-ref refs/remotes/origin/HEAD refs/remotes/origin/trunk`.cwd(dir).quiet();
    await $`git checkout -q main && git ${OWNER} commit -q --no-gpg-sign --allow-empty -m later`.cwd(dir).quiet();
    await $`git update-ref refs/remotes/origin/main HEAD && git checkout -q feature`.cwd(dir).quiet();

    const viaOriginHead = await lint();
    expect(viaOriginHead.text).toContain(`checks-lint: range ${base}..${head} from HEAD against origin/trunk\n`);
    expect(viaOriginHead.text).toContain("commit-identity: 1 commit(s)");
    expect(viaOriginHead.text).toContain("checks-lint: 6 gate(s) pass");
    expect(viaOriginHead.exitCode).toBe(0);

    await $`git symbolic-ref --delete refs/remotes/origin/HEAD`.cwd(dir).quiet();
    const viaOriginMain = await lint();
    expect(viaOriginMain.text).toContain(`checks-lint: range ${base}..${head} from HEAD against origin/main\n`);
    expect(viaOriginMain.exitCode).toBe(0);

    const explicit = await lint([head, head]);
    expect(explicit.text).toContain(`checks-lint: tip ${head} from ${head} against ${head}\n`);
    expect(explicit.text).toContain(`commit-identity: 1 commit(s) in ${head} carry only allowed identities`);
    expect(explicit.exitCode).toBe(0);

    const usage = await lint([head]);
    expect(usage.text).toContain("checks-lint: usage: lint.ts [<base-ref> <head-ref>]");
    expect(usage.exitCode).toBe(2);

    await $`git update-ref -d refs/remotes/origin/main`.cwd(dir).quiet();
    const unresolved = await lint();
    expect(unresolved.text).toContain("checks-lint: origin/main is not a commit in this clone");
    expect(unresolved.exitCode).toBe(2);
  },
  60_000,
);

test(
  "without origin/HEAD the range starts from the ciWiring.defaultBranch the repository declares",
  async () => {
    const base = await initRepo({ ciWiring: { gates: ["bun run lint"], defaultBranch: "trunk" } });
    await writeFile(join(dir, "clean.ts"), "export const answer = 42;\n");
    const head = await commit("feat: clean");
    await $`git update-ref refs/remotes/origin/trunk ${base}`.cwd(dir).quiet();
    await $`git symbolic-ref --delete refs/remotes/origin/HEAD`.cwd(dir).quiet();
    await $`git update-ref -d refs/remotes/origin/main`.cwd(dir).quiet();

    const declared = await lint();
    expect(declared.text).toContain(`checks-lint: range ${base}..${head} from HEAD against origin/trunk\n`);
    expect(declared.text).toContain("checks-lint: 6 gate(s) pass");
    expect(declared.exitCode).toBe(0);
  },
  60_000,
);

test(
  "when the head is the base branch's tip, as on a push to it, every range gate checks that tip alone",
  async () => {
    await initRepo();
    await $`git checkout -q main`.cwd(dir).quiet();
    await suppressions(3);
    await writeFile(join(dir, "widget.ts"), "// @ts-ignore\nexport const widget = 42;\n");
    const tip = await commit("feat: pushed", STRANGER);
    await $`git update-ref refs/remotes/origin/main HEAD`.cwd(dir).quiet();

    const pushed = await lint();
    expect(pushed.text).toContain(`checks-lint: tip ${tip} from HEAD against origin/main\n`);
    expect(pushed.text).toContain(
      "checks-lint: 3 of 6 gate(s) failed: checks-commit-identity, checks-comment-gate, checks-suppressions-ratchet\n",
    );
    expect(pushed.exitCode).toBe(1);
  },
  60_000,
);

test(
  "in a pull request the range ends at the event's head, not at the merge commit checked out",
  async () => {
    const base = await initRepo();
    await writeFile(join(dir, "clean.ts"), "export const answer = 42;\n");
    const head = await commit("feat: clean");
    const github = ["-c", "user.name=GitHub", "-c", "user.email=noreply@github.com"];
    await $`git checkout -q --detach main && git ${github} merge -q --no-ff --no-gpg-sign -m merge feature`
      .cwd(dir)
      .quiet();
    const event = join(dir, "..", `${dir.split("/").at(-1)}-event.json`);
    await writeFile(event, JSON.stringify({ pull_request: { number: 7, base: { ref: "main" }, head: { sha: head } } }));

    const local = await lint();
    expect(local.text).toContain("checks-commit-identity");
    expect(local.exitCode).toBe(1);

    const pullRequest = await lint([], { GITHUB_EVENT_NAME: "pull_request", GITHUB_EVENT_PATH: event });
    expect(pullRequest.text).toContain(`checks-lint: range ${base}..${head} from pull request #7 into main\n`);
    expect(pullRequest.text).toContain("checks-lint: 6 gate(s) pass");
    expect(pullRequest.exitCode).toBe(0);

    await writeFile(event, JSON.stringify({ pull_request: { base: { ref: "main" } } }));
    const malformed = await lint([], { GITHUB_EVENT_NAME: "pull_request", GITHUB_EVENT_PATH: event });
    expect(malformed.text).toContain(`checks-lint: cannot read the pull request from ${event}`);
    expect(malformed.exitCode).toBe(2);
    await rm(event);
  },
  60_000,
);

test(
  "a raised suppression count, a banned comment directive and a foreign identity each fail by gate name",
  async () => {
    await initRepo();

    await suppressions(3);
    await commit("chore: raise");
    const raised = await lint();
    expect(raised.text).toContain("suppressions-ratchet: 1 count(s)");
    expect(raised.text).toContain("checks-lint: 1 of 6 gate(s) failed: checks-suppressions-ratchet\n");
    expect(raised.exitCode).toBe(1);
    await suppressions(2);
    await commit("chore: lower");
    expect((await lint()).exitCode).toBe(0);

    await writeFile(join(dir, "widget.ts"), "// @ts-ignore\nexport const widget = 42;\n");
    await commit("fix: widget");
    const directive = await lint();
    expect(directive.text).toContain("comment-gate: 1 violation(s)");
    expect(directive.text).toContain("checks-lint: 1 of 6 gate(s) failed: checks-comment-gate\n");
    expect(directive.exitCode).toBe(1);
    await writeFile(join(dir, "widget.ts"), "export const widget = 42;\n");
    await commit("fix: drop the directive");
    expect((await lint()).exitCode).toBe(0);

    await writeFile(join(dir, "other.ts"), "export const other = 1;\n");
    await commit("feat: other", STRANGER);
    const foreign = await lint();
    expect(foreign.text).toContain("commit-identity: 1 of");
    expect(foreign.text).toContain("checks-lint: 1 of 6 gate(s) failed: checks-commit-identity\n");
    expect(foreign.exitCode).toBe(1);
    await $`git ${OWNER} commit -q --no-gpg-sign --amend --no-edit --reset-author`.cwd(dir).quiet();
    const cleared = await lint();
    expect(cleared.text).toContain("checks-lint: 6 gate(s) pass");
    expect(cleared.exitCode).toBe(0);
  },
  60_000,
);

test(
  "every failing gate is named, and a run where none decided a violation exits 2",
  async () => {
    await initRepo();
    await suppressions(3);
    await writeFile(join(dir, "widget.ts"), "// @ts-ignore\nexport const widget = 42;\n");
    await commit("feat: everything", STRANGER);

    const all = await lint();
    expect(all.text).toContain(
      "checks-lint: 3 of 6 gate(s) failed: checks-commit-identity, checks-comment-gate, checks-suppressions-ratchet\n",
    );
    expect(all.exitCode).toBe(1);

    await $`git reset -q --hard origin/main`.cwd(dir).quiet();
    await writeFile(join(dir, "package.json"), JSON.stringify({ scripts: { lint: "checks-lint", test: "bun test --randomize" } }));
    await commit("chore: drop the wiring");
    const undecided = await lint();
    expect(undecided.text).toContain("ci-wiring:");
    expect(undecided.text).toContain("checks-lint: 1 of 6 gate(s) failed: checks-ci-wiring\n");
    expect(undecided.exitCode).toBe(2);
  },
  60_000,
);
