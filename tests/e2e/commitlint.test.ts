import { $ } from "bun";
import { expect, test } from "bun:test";
import { symlink } from "node:fs/promises";
import { join } from "node:path";
import { withoutPullRequestEvent } from "../lib/env.ts";
import { CHECKOUT, fixtureRepos, ran, scratchDirs, type Ran } from "./lib/fixture-repo.ts";

const scratch = scratchDirs();
const repository = fixtureRepos("commit-title-dispatch-");
const BIN = join(CHECKOUT, "src", "delivery", "commit-title.ts");

function lint(message: string): Promise<Ran> {
  const binary = join(CHECKOUT, "node_modules", ".bin", "commitlint");
  const config = join(CHECKOUT, "commitlint.config.ts");
  return ran($`printf "%s" ${message} | ${binary} --config ${config}`);
}

test(
  "commitlint config rejects a non-conventional message",
  async () => {
    const red = await lint("update stuff");
    expect(red.exitCode).not.toBe(0);
  },
  60_000,
);

test(
  "commitlint config accepts a conventional message",
  async () => {
    const green = await lint("feat(lint): add x (#12)");
    expect(green.exitCode).toBe(0);
  },
  60_000,
);

test(
  "commitlint config accepts house prefixes, rejects unknown types and long headers",
  async () => {
    const house = [
      "theme",
      "renamer",
      "shell",
      "pi",
      "home",
      "audit",
      "comments",
      "unslop",
    ];
    for (const type of house) {
      const green = await lint(`${type}(scope): add x`);
      expect(green.exitCode).toBe(0);
    }
    const red = await lint("frobnicate(scope): add x");
    expect(red.exitCode).not.toBe(0);
    const atLimit = `feat(scope): ${"x".repeat(100 - "feat(scope): ".length)}`;
    expect(atLimit.length).toBe(100);
    const accepted = await lint(atLimit);
    expect(accepted.exitCode).toBe(0);
    expect(accepted.text).not.toContain("[header-max-length]");
    const header = `feat(scope): ${"x".repeat(101 - "feat(scope): ".length)}`;
    expect(header.length).toBe(101);
    const long = await lint(header);
    expect(long.exitCode).not.toBe(0);
    expect(long.text).toContain("[header-max-length]");
  },
  120_000,
);

function titleLinter(path: string): (title: string) => Promise<Ran> {
  return (title) =>
    ran($`bun ${BIN}`.cwd(CHECKOUT).env({ ...withoutPullRequestEvent(), PR_TITLE: title, GITHUB_EVENT_NAME: "pull_request", PATH: path }));
}

test(
  "the title bin rejects a title that opens with the git comment character",
  async () => {
    const lintTitle = titleLinter(process.env["PATH"] ?? "");

    const red = await lintTitle("# feat(lint): add x");
    expect(red.exitCode).not.toBe(0);
    expect(red.text).toContain("[type-empty]");
    expect(red.text).toContain("[subject-empty]");

    const green = await lintTitle("feat(lint): add x");
    expect(green.exitCode).toBe(0);
    expect(green.text).toBe("");
  },
  60_000,
);

test(
  "the title bin lints without node on PATH",
  async () => {
    const dir = await scratch("commit-title-bin-");
    for (const name of ["bun", "git", "env"]) {
      const found = Bun.which(name);
      if (found === null) throw new Error(`${name} is missing from PATH`);
      await symlink(found, join(dir, name));
    }
    const lintTitle = titleLinter(dir);
    if (Bun.which("node", { PATH: dir }) !== null) throw new Error("node leaked onto the test PATH");
    expect((await lintTitle("feat(lint): add x")).text).toBe("");
    expect((await lintTitle("# feat(lint): add x")).exitCode).not.toBe(0);
  },
  60_000,
);

test(
  "the title bin passes a push run with nothing to lint",
  async () => {
    const pushed = await ran(
      $`bun ${BIN}`.cwd(CHECKOUT).env({ ...withoutPullRequestEvent(), GITHUB_EVENT_NAME: "push", PATH: process.env["PATH"] ?? "" }),
    );
    expect(pushed.exitCode).toBe(0);
    expect(pushed.text).toContain("nothing to lint");
  },
  60_000,
);

// The fake answers the pull request list with FAKE_PULLS and runs the caller's --jq filter through jq, as gh does.
async function dispatchedLinter(subject: string): Promise<(pulls: readonly { readonly title: string }[]) => Promise<Ran>> {
  const repo = await repository({ "notes.txt": "one\n" });
  await repo.commit(subject);
  const bin = await scratch("commit-title-gh-");
  await Bun.write(join(bin, "gh"), '#!/bin/sh\nwhile [ "$1" != "--jq" ]; do shift; done\nprintf "%s" "$FAKE_PULLS" | jq -r "$2"\n');
  await $`chmod +x ${join(bin, "gh")}`.quiet();
  return (pulls) =>
    ran(
      $`bun ${BIN}`.cwd(repo.dir).env({
        ...withoutPullRequestEvent(),
        PR_TITLE: "",
        GITHUB_EVENT_NAME: "workflow_dispatch",
        GITHUB_REPOSITORY: "acme/widget",
        GITHUB_REPOSITORY_OWNER: "acme",
        GITHUB_REF_NAME: "release/main",
        FAKE_PULLS: JSON.stringify(pulls),
        PATH: `${bin}:${process.env["PATH"] ?? ""}`,
      }),
    );
}

test(
  "a dispatched run lints the title of the one open pull request its branch heads, and the head subject when none does",
  async () => {
    const released = await dispatchedLinter("chore: release 0.1.1");
    expect(await released([])).toEqual({ exitCode: 0, text: "" });
    expect((await released([{ title: "update stuff" }])).exitCode).not.toBe(0);
    expect(await released([{ title: "feat(lint): add x" }])).toEqual({ exitCode: 0, text: "" });

    const unconventional = await dispatchedLinter("update stuff");
    const refused = await unconventional([]);
    expect(refused.exitCode).not.toBe(0);
    expect(refused.text).toContain("[type-empty]");
  },
  60_000,
);

test(
  "a dispatched run whose branch heads two open pull requests lints nothing and fails",
  async () => {
    const lintDispatched = await dispatchedLinter("chore: release 0.1.1");
    const ambiguous = await lintDispatched([{ title: "feat(lint): add x" }, { title: "fix(lint): mend y" }]);
    expect(ambiguous.exitCode).not.toBe(0);
    expect(ambiguous.text).toContain("more than one open pull request heads the branch");
  },
  60_000,
);

type Scenario = {
  readonly event: string;
  readonly headSha: string | undefined;
  readonly outcome: string;
  readonly posted: { readonly sha: string; readonly state: string };
};

const GITHUB_SHA = "2222222222222222222222222222222222222222";
const HEAD_SHA = "1111111111111111111111111111111111111111";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function contextValue(contexts: unknown, path: string): string {
  const found = path.split(".").reduce<unknown>((node, key) => (isRecord(node) ? node[key] : undefined), contexts);
  return typeof found === "string" ? found : "";
}

function contextPath(value: unknown): string | undefined {
  return /^\$\{\{\s*([\w.-]+)\s*\}\}$/.exec(String(value))?.[1];
}

function resolved(env: Record<string, unknown>, contexts: unknown): Record<string, string> {
  return Object.fromEntries(
    Object.entries(env).map(([name, value]) => {
      const path = contextPath(value);
      if (path === undefined) throw new Error(`${name} is not a plain context lookup: ${String(value)}`);
      return [name, contextValue(contexts, path)];
    }),
  );
}

async function titleStatusSteps(): Promise<readonly Record<string, unknown>[]> {
  const workflow: unknown = Bun.YAML.parse(await Bun.file(join(CHECKOUT, ".github", "workflows", "ci.yml")).text());
  const jobs = isRecord(workflow) ? workflow["jobs"] : undefined;
  const steps = isRecord(jobs) ? Object.values(jobs).flatMap((job) => (isRecord(job) && Array.isArray(job["steps"]) ? job["steps"] : [])) : [];
  return steps.filter(
    (step): step is Record<string, unknown> =>
      isRecord(step) && isRecord(step["env"]) && Object.values(step["env"]).some((value) => contextPath(value) === "steps.title.outcome"),
  );
}

test(
  "the ci job always posts the title outcome as a commitlint status on pull_request and dispatch alike",
  async () => {
    const [step, ...others] = await titleStatusSteps();
    expect(others).toEqual([]);
    if (step === undefined || !isRecord(step["env"]) || typeof step["run"] !== "string") throw new Error("no step reports the title outcome");
    expect(step["if"]).toBe("always()");

    const scenarios: readonly Scenario[] = [
      { event: "pull_request", headSha: HEAD_SHA, outcome: "success", posted: { sha: HEAD_SHA, state: "success" } },
      { event: "pull_request", headSha: HEAD_SHA, outcome: "failure", posted: { sha: HEAD_SHA, state: "failure" } },
      { event: "workflow_dispatch", headSha: undefined, outcome: "success", posted: { sha: GITHUB_SHA, state: "success" } },
      { event: "workflow_dispatch", headSha: undefined, outcome: "failure", posted: { sha: GITHUB_SHA, state: "failure" } },
      { event: "workflow_dispatch", headSha: undefined, outcome: "skipped", posted: { sha: GITHUB_SHA, state: "failure" } },
    ];
    const dir = await scratch("commitlint-status-");
    await Bun.write(join(dir, "gh"), '#!/bin/sh\nprintf "%s\\n" "$@" > "$GH_ARGS"\n');
    await $`chmod +x ${join(dir, "gh")}`.quiet();
    for (const { event, headSha, outcome, posted } of scenarios) {
      const contexts = {
        github: { token: "token", event: headSha === undefined ? {} : { pull_request: { head: { sha: headSha } } } },
        steps: { title: { outcome } },
      };
      const argsFile = join(dir, `${event}-${outcome}.args`);
      const env = {
        ...resolved(step["env"], contexts),
        PATH: `${dir}:${process.env["PATH"] ?? ""}`,
        GH_ARGS: argsFile,
        GITHUB_EVENT_NAME: event,
        GITHUB_SHA,
        GITHUB_REPOSITORY: "acme/widget",
        GITHUB_SERVER_URL: "https://github.com",
        GITHUB_RUN_ID: "7",
      };
      const reported = await ran($`bash --noprofile --norc -eo pipefail -c ${step["run"]}`.env(env));
      expect(reported).toEqual({ exitCode: 0, text: "" });
      const args = (await Bun.file(argsFile).text()).trimEnd().split("\n");
      expect(args.slice(0, 2)).toEqual(["api", `repos/acme/widget/statuses/${posted.sha}`]);
      const fields = args.flatMap((arg, index) => (args[index - 1] === "-f" ? [arg] : []));
      expect(fields).toContain(`state=${posted.state}`);
      expect(fields).toContain("context=commitlint");
    }
  },
  60_000,
);
