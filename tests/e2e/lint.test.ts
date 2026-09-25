import { $ } from "bun";
import { expect, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { withoutPullRequestEvent } from "../lib/env.ts";
import { CHECKOUT, ran, scratchDirs, UNVENDORED_BUNFIG, type Ran } from "./lib/fixture-repo.ts";

const SCRIPT = join(CHECKOUT, "scripts", "lint.ts");
const QUALITY_SCRIPT = join(CHECKOUT, "scripts", "quality.ts");
const OWNER = ["-c", "user.name=avi2d", "-c", "user.email=avi2dg@gmail.com"];
const STRANGER = ["-c", "user.name=stranger", "-c", "user.email=stranger@example.com"];
const FIXTURE_AUTHOR = { name: "Wren Fixture", email: "wren@example.com" };
const FIXTURE = ["-c", `user.name=${FIXTURE_AUTHOR.name}`, "-c", `user.email=${FIXTURE_AUTHOR.email}`];
const METADATA_GATES = ["checks-commit-identity", "checks-comment-gate", "checks-suppressions-ratchet", "checks-ci-wiring", "checks-docs", "checks-quarantine-clock"];
const FOUNDER = { name: "founder", email: "founder@example.com" };
const FOUNDER_IDENTITY = ["-c", `user.name=${FOUNDER.name}`, "-c", `user.email=${FOUNDER.email}`];

const LOCAL_ENV = {
  ...withoutPullRequestEvent(),
  PATH: `${join(CHECKOUT, "node_modules", ".bin")}:${process.env["PATH"] ?? ""}`,
};

const scratch = scratchDirs();

let dir = "";

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

async function scaffold(quality: Record<string, unknown> = {}): Promise<void> {
  dir = await scratch("checks-lint-");
  await writeFile(
    join(dir, "package.json"),
    JSON.stringify({ name: "checks-lint-fixture", type: "module", scripts: { lint: "checks-lint", test: "checks-test" } }),
  );
  await writeFile(join(dir, "quality.json"), JSON.stringify({ gates: { ci: ["bun run lint"] }, ...quality }));
  await writeFile(join(dir, "bunfig.toml"), UNVENDORED_BUNFIG);
  await writeFile(join(dir, "widget.ts"), "export const widget = 42;\n");
  await $`git init -q -b main`.cwd(dir).quiet();
  await $`bun ${QUALITY_SCRIPT} generate`.cwd(dir).env(LOCAL_ENV).quiet();
}

async function initRepo(quality: Record<string, unknown> = {}): Promise<string> {
  await scaffold(quality);
  await suppressions(2);
  const base = await commit("feat: base");
  await $`git update-ref refs/remotes/origin/main HEAD`.cwd(dir).quiet();
  await $`git symbolic-ref refs/remotes/origin/HEAD refs/remotes/origin/main`.cwd(dir).quiet();
  await $`git checkout -q -b feature`.cwd(dir).quiet();
  return base;
}

async function writeSourceFreeManifest(lintGates?: readonly string[]): Promise<void> {
  await writeFile(join(dir, "package.json"), JSON.stringify({ name: "source-free-fixture", scripts: { lint: "checks-lint" } }));
  await writeFile(
    join(dir, "quality.json"),
    JSON.stringify({ commitIdentity: { authors: [FIXTURE_AUTHOR] }, gates: { ci: ["bun run lint"], lint: lintGates } }),
  );
}

async function foundRepo(): Promise<string> {
  await scaffold({ commitIdentity: { authors: [FOUNDER] } });
  return commit("feat: first commit", FOUNDER_IDENTITY);
}

async function initSourceFreeRepo(lintGates?: readonly string[]): Promise<void> {
  dir = await scratch("checks-lint-source-free-");
  await writeSourceFreeManifest(lintGates);
  await mkdir(join(dir, ".github", "workflows"), { recursive: true });
  await writeFile(
    join(dir, ".github", "workflows", "ci.yml"),
    "on: pull_request\njobs:\n  lint:\n    runs-on: ubuntu-latest\n    steps:\n      - run: bun run lint\n",
  );
  await writeFile(join(dir, "README.md"), "# Notes\n");
  await $`git init -q -b main`.cwd(dir).quiet();
  if (lintGates === undefined) await $`bun ${QUALITY_SCRIPT} generate`.cwd(dir).env(LOCAL_ENV).quiet();
  await commit("docs: base", FIXTURE);
  await $`git update-ref refs/remotes/origin/main HEAD`.cwd(dir).quiet();
  await $`git symbolic-ref refs/remotes/origin/HEAD refs/remotes/origin/main`.cwd(dir).quiet();
  await $`git checkout -q -b feature`.cwd(dir).quiet();
}

function lint(args: readonly string[] = [], env: Readonly<Record<string, string>> = {}, cwd: string = dir): Promise<Ran> {
  return ran($`bun ${SCRIPT} ${args}`.cwd(cwd).env({ ...LOCAL_ENV, ...env }));
}

test(
  "the range starts where HEAD branched from origin/HEAD, then the declared default branch, unless arguments name it",
  async () => {
    const base = await initRepo({ defaultBranch: "trunk" });
    await writeFile(join(dir, "clean.ts"), "export const answer = 42;\n");
    const head = await commit("feat: clean");
    await $`git update-ref refs/remotes/origin/trunk ${base}`.cwd(dir).quiet();
    await $`git symbolic-ref refs/remotes/origin/HEAD refs/remotes/origin/trunk`.cwd(dir).quiet();
    await $`git checkout -q main && git ${OWNER} commit -q --no-gpg-sign --allow-empty -m later`.cwd(dir).quiet();
    await $`git update-ref refs/remotes/origin/main HEAD && git checkout -q feature`.cwd(dir).quiet();

    const viaOriginHead = await lint();
    expect(viaOriginHead.text).toContain(`checks-lint: range ${base}..${head} from HEAD against origin/trunk\n`);
    expect(viaOriginHead.text).toContain("commit-identity: 1 commit(s)");
    expect(viaOriginHead.text).toContain("checks-lint: 12 gate(s) pass");
    expect(viaOriginHead.exitCode).toBe(0);

    const explicit = await lint([base, "missing"]);
    expect(explicit.text).toContain("checks-lint: missing is not a commit in this clone");
    expect(explicit.exitCode).toBe(2);

    const usage = await lint([head]);
    expect(usage.text).toContain("checks-lint: usage: lint.ts [<base-ref> <head-ref>]");
    expect(usage.exitCode).toBe(2);

    await $`git symbolic-ref --delete refs/remotes/origin/HEAD && git update-ref -d refs/remotes/origin/trunk`.cwd(dir).quiet();
    const declared = await lint();
    expect(declared.text).toContain("checks-lint: origin/trunk is not a commit in this clone");
    expect(declared.exitCode).toBe(2);
  },
  60_000,
);

test(
  "package.json ciWiring still decides while quality.json is absent, and declaring both at once is refused",
  async () => {
    await initRepo();
    await rm(join(dir, "quality.json"));
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({ scripts: { lint: "checks-lint", test: "checks-test" }, ciWiring: { gates: ["bun run lint"] } }),
    );
    await commit("chore: wire through package.json");
    const legacy = await lint();
    expect(legacy.text).toContain("package.json sets ciWiring, which a later minor release stops reading; move it into quality.json");
    expect(legacy.text).toContain("ci-wiring: 1 gate(s) run on pull requests to main");
    expect(legacy.text).toContain("checks-lint: 12 gate(s) pass");
    expect(legacy.exitCode).toBe(0);

    await writeFile(join(dir, "quality.json"), JSON.stringify({ gates: { ci: ["bun run lint"] } }));
    const both = await lint();
    expect(both.text).toContain("checks-lint: package.json still sets ciWiring, which quality.json replaces; move what it holds there");
    expect(both.exitCode).toBe(2);
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
      "checks-lint: 3 of 12 gate(s) failed: checks-commit-identity, checks-comment-gate, checks-suppressions-ratchet\n",
    );
    expect(pushed.exitCode).toBe(1);
  },
  60_000,
);

test(
  "a new repository's root commit, pushed to main, gets a verdict from every range gate",
  async () => {
    const clean = await foundRepo();
    await $`git update-ref refs/remotes/origin/main HEAD`.cwd(dir).quiet();

    const pushed = await lint();
    expect(pushed.text).toContain(`checks-lint: tip ${clean} from HEAD against origin/main\n`);
    expect(pushed.text).toContain("checks-lint: 12 gate(s) pass");
    expect(pushed.exitCode).toBe(0);

    await suppressions(1);
    await writeFile(join(dir, "widget.ts"), "// @ts-ignore\nexport const widget = 42;\n");
    await $`git add -A && git ${FOUNDER_IDENTITY} commit -q --no-gpg-sign --amend --no-edit`.cwd(dir).quiet();
    const dirty = (await $`git rev-parse HEAD`.cwd(dir).quiet()).stdout.toString().trim();
    await $`git update-ref refs/remotes/origin/main HEAD`.cwd(dir).quiet();

    const violated = await lint();
    expect(violated.text).toContain(`checks-lint: tip ${dirty} from HEAD against origin/main\n`);
    expect(violated.text).toContain("widget.ts:1 carries the machine-read directive `@ts-ignore`");
    expect(violated.text).toContain("widget.ts eslint/no-debugger appeared with 1");
    expect(violated.text).toContain(
      "checks-lint: 2 of 12 gate(s) failed: checks-comment-gate, checks-suppressions-ratchet\n",
    );
    expect(violated.exitCode).toBe(1);
  },
  60_000,
);

test(
  "a freshly initialised repository with no remote gets HEAD judged alone, its root commit against the empty tree",
  async () => {
    const clean = await foundRepo();

    const passed = await lint();
    expect(passed.text).toContain(
      `checks-lint: tip ${clean} from HEAD alone, as the clone has no remote-tracking refs\n`,
    );
    expect(passed.text).toContain("checks-lint: 12 gate(s) pass");
    expect(passed.exitCode).toBe(0);

    await writeFile(join(dir, "widget.ts"), "// @ts-ignore\nexport const widget = 42;\n");
    await $`git add -A && git ${FOUNDER_IDENTITY} commit -q --no-gpg-sign --amend --no-edit`.cwd(dir).quiet();
    const violated = await lint();
    expect(violated.text).toContain("widget.ts:1 carries the machine-read directive `@ts-ignore`");
    expect(violated.text).toContain("checks-lint: 1 of 12 gate(s) failed: checks-comment-gate\n");
    expect(violated.exitCode).toBe(1);
  },
  60_000,
);

test(
  "a clone with remote-tracking refs but no origin/main still refuses to resolve the range",
  async () => {
    await foundRepo();
    await $`git checkout -q -b feature`.cwd(dir).quiet();
    await writeFile(join(dir, "clean.ts"), "export const answer = 42;\n");
    await commit("feat: clean", FOUNDER_IDENTITY);
    await $`git checkout -q main`.cwd(dir).quiet();
    const clone = join(dir, "clone");
    await $`git clone -q --single-branch --branch feature ${dir} ${clone}`.quiet();

    const refused = await lint([], {}, clone);
    expect(refused.text).toContain(
      "checks-lint: origin/main is not a commit in this clone; a CI checkout needs actions/checkout fetch-depth: 0",
    );
    expect(refused.exitCode).toBe(2);
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
    expect(pullRequest.text).toContain("checks-lint: 12 gate(s) pass");
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
    expect(raised.text).toContain("checks-lint: 1 of 12 gate(s) failed: checks-suppressions-ratchet\n");
    expect(raised.exitCode).toBe(1);
    await suppressions(2);
    await commit("chore: lower");
    expect((await lint()).exitCode).toBe(0);

    await writeFile(join(dir, "widget.ts"), "// @ts-ignore\nexport const widget = 42;\n");
    await commit("fix: widget");
    const directive = await lint();
    expect(directive.text).toContain("comment-gate: 1 violation(s)");
    expect(directive.text).toContain("checks-lint: 1 of 12 gate(s) failed: checks-comment-gate\n");
    expect(directive.exitCode).toBe(1);
    await writeFile(join(dir, "widget.ts"), "export const widget = 42;\n");
    await commit("fix: drop the directive");
    expect((await lint()).exitCode).toBe(0);

    await writeFile(join(dir, "other.ts"), "export const other = 1;\n");
    await commit("feat: other", STRANGER);
    const foreign = await lint();
    expect(foreign.text).toContain("commit-identity: 1 of");
    expect(foreign.text).toContain("checks-lint: 1 of 12 gate(s) failed: checks-commit-identity\n");
    expect(foreign.exitCode).toBe(1);
    await $`git ${OWNER} commit -q --no-gpg-sign --amend --no-edit --reset-author`.cwd(dir).quiet();
    const cleared = await lint();
    expect(cleared.text).toContain("checks-lint: 12 gate(s) pass");
    expect(cleared.exitCode).toBe(0);
  },
  60_000,
);

test(
  "a source-free repository runs only the gates it selects, and TypeScript source refuses that selection",
  async () => {
    await initSourceFreeRepo();
    await writeFile(join(dir, "NOTES.md"), "More notes.\n");
    await commit("docs: notes", FIXTURE);
    const everyGate = await lint();
    expect(everyGate.text).toContain("checks-lint: 1 of 12 gate(s) failed: checks-test-layout\n");
    expect(everyGate.exitCode).toBe(1);

    await writeSourceFreeManifest([...METADATA_GATES, "checks-quality"]);
    await commit("chore: select the metadata gates", FIXTURE);
    const selected = await lint();
    expect(selected.text).toContain(
      "checks-lint: quality.json selects checks-commit-identity, checks-comment-gate, checks-suppressions-ratchet, checks-ci-wiring, checks-docs, checks-quality, checks-quarantine-clock\n",
    );
    expect(selected.text).not.toContain("test-layout:");
    expect(selected.text).not.toContain("lint-coverage:");
    expect(selected.text).toContain("suppressions-ratchet:");
    expect(selected.text).toContain("checks-lint: 7 gate(s) pass\n");
    expect(selected.exitCode).toBe(0);

    await mkdir(join(dir, "src"));
    await writeFile(join(dir, "src", "widget.ts"), "export const widget = 42;\n");
    await commit("feat: widget", FIXTURE);
    const withSource = await lint();
    expect(withSource.text).toContain(
      [
        "ci-wiring: quality.json gates.lint leaves out 5 gate(s) this repository's contents make applicable:",
        "  checks-lint-coverage: the repository tracks TypeScript source (src/widget.ts)",
        "  checks-test-layout: the repository tracks TypeScript source (src/widget.ts)",
        "  checks-size-budget: the repository tracks TypeScript source (src/widget.ts)",
        "  checks-repetition: the repository tracks TypeScript source (src/widget.ts)",
        "  checks-feature-owners: the repository tracks TypeScript source (src/widget.ts)",
      ].join("\n"),
    );
    expect(withSource.text).toContain("checks-lint: 1 of 7 gate(s) failed: checks-ci-wiring\n");
    expect(withSource.exitCode).toBe(1);
  },
  60_000,
);

test(
  "a selection that leaves out a gate every repository runs, or names no kit gate, runs nothing",
  async () => {
    await initSourceFreeRepo(["checks-commit-identity", "checks-comment-gate", "checks-suppressions-ratchet", "checks-docs", "checks-quarantine-clock"]);
    const withoutWiring = await lint();
    expect(withoutWiring.text).toContain("checks-lint must run checks-ci-wiring, which applies to every repository");
    expect(withoutWiring.text).not.toContain("commit-identity:");
    expect(withoutWiring.exitCode).toBe(2);

    await writeSourceFreeManifest(["checks-commit-identity", "checks-comment-gate", "checks-ci-wiring", "checks-docs", "checks-quarantine-clock"]);
    const withoutRatchet = await lint();
    expect(withoutRatchet.text).toContain("checks-lint must run checks-suppressions-ratchet, which applies to every repository");
    expect(withoutRatchet.text).not.toContain("commit-identity:");
    expect(withoutRatchet.exitCode).toBe(2);

    await writeSourceFreeManifest([...METADATA_GATES, "checks-typo"]);
    const unknown = await lint();
    expect(unknown.text).toContain('Expected "checks-lint-coverage" |');
    expect(unknown.exitCode).toBe(2);
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
      "checks-lint: 3 of 12 gate(s) failed: checks-commit-identity, checks-comment-gate, checks-suppressions-ratchet\n",
    );
    expect(all.exitCode).toBe(1);

    await $`git reset -q --hard origin/main`.cwd(dir).quiet();
    await writeFile(join(dir, "quality.json"), "{}");
    await commit("chore: drop the wiring");
    const undecided = await lint();
    expect(undecided.text).toContain("ci-wiring:");
    expect(undecided.text).toContain("checks-lint: 1 of 12 gate(s) failed: checks-ci-wiring\n");
    expect(undecided.exitCode).toBe(2);
  },
  60_000,
);
