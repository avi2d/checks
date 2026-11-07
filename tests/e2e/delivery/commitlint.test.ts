import { $ } from "bun";
import { expect, test } from "bun:test";
import { symlink } from "node:fs/promises";
import { join } from "node:path";
import { withoutPullRequestEvent } from "../../lib/env.ts";
import { CHECKOUT, fixtureRepos, ran, scratchDirs, type Ran } from "../lib/fixture-repo.ts";

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
  "commitlint config accepts the titles Dependabot writes for a single, grouped, joint, requirement or in-directory update, with or without the pull request number",
  async () => {
    const dependabot = [
      "build(deps): Bump actions/checkout from 5.1.0 to 7.0.1",
      "build(deps): Bump actions/checkout from 5.1.0 to 7.0.1 in /actions/setup",
      "build(deps): bump business from 1.4.0 to 1.5.0",
      "build(deps): Bump business from `2468a02` to `cff701b`",
      "build(deps): Bump business from 1.4.0 to 1.5.0 in /directory",
      "build(deps): Bump business from 1.4.0 to 1.5.0 in the all-the-things group",
      "build(deps): Bump business from 1.4.0 to 1.5.0 in the go_modules group across 1 directory",
      "build(deps): Bump business from 1.4.0 to 1.5.0 in the go_modules group across 2 directories",
      "build(deps): Bump business and business2",
      "build(deps): Bump business, business2 and business3",
      "build(deps): Bump business across 2 directories",
      "build(deps): Bump business across 10 directories",
      "build(deps): Bump business in /frontend",
      "build(deps): Bump the all-the-things group with 1 update",
      "build(deps): Bump the all-the-things group with 2 updates",
      "build(deps): Bump the all-the-things group in /directory with 2 updates",
      "build(deps): Bump the go_modules group across 2 directories with 2 updates",
      "build(deps): Bump the npm_and_yarn group across 1 directory with 3 updates",
      "build(deps): Update business requirement from ~> 1.4.0 to ~> 1.5.0",
      "build(deps): Update business requirement from v0.3.0 to v0.4.1",
      "build(deps-dev): Bump the all-the-things group with 2 updates",
    ];
    for (const title of dependabot) {
      for (const landed of [title, `${title} (#3)`]) {
        const green = await lint(landed);
        expect({ title: landed, exitCode: green.exitCode, text: green.text }).toEqual({ title: landed, exitCode: 0, text: "" });
      }
    }
  },
  120_000,
);

test(
  "commitlint config accepts a Dependabot title whose old version is unknown or whose requirement lists several values, and refuses a title with no new version",
  async () => {
    const dependabot = [
      "build(deps): Bump actions/checkout to v2.2.0",
      "build(deps): Update actions/checkout requirement to v2.2.0",
      "build(deps): Update JSON requirement from ^0.20, ^0.21 to ^0.20, ^0.21, 1.5",
    ];
    for (const title of dependabot) {
      for (const landed of [title, `${title} (#3)`]) {
        const green = await lint(landed);
        expect({ title: landed, exitCode: green.exitCode, text: green.text }).toEqual({ title: landed, exitCode: 0, text: "" });
      }
    }
    for (const title of ["build(deps): Bump actions/checkout to", "build(deps): Update actions/checkout requirement to"]) {
      const red = await lint(title);
      expect({ title, exitCode: red.exitCode === 0 ? 0 : 1, flagged: red.text.includes("[subject-case]") }).toEqual({
        title,
        exitCode: 1,
        flagged: true,
      });
    }
  },
  120_000,
);

test(
  "commitlint config still applies subject-case to a title no Dependabot shape matches, such as an arbitrary Bump, an arbitrary Update, a trailing full stop, a chore prefix or a wrong type",
  async () => {
    const refused = [
      "build(deps): Bump",
      "build(deps): Bump hello world",
      "build(deps): Bump the thing",
      "build(deps): Bump business from 1.4.0 to 1.5.0.",
      "build(deps): Bump business from 1.4.0 to 1.5.0. (#3)",
      "build(deps): Update anything at all",
      "build(ci): Bump actions/checkout from 5.1.0 to 7.0.1",
      "chore(deps): Bump actions/checkout from 5.1.0 to 7.0.1",
      "feat(deps): Bump actions/checkout from 5.1.0 to 7.0.1",
      "feat: Add thing",
    ];
    for (const title of refused) {
      const red = await lint(title);
      expect({ title, exitCode: red.exitCode === 0 ? 0 : 1, flagged: red.text.includes("[subject-case]") }).toEqual({
        title,
        exitCode: 1,
        flagged: true,
      });
    }
  },
  120_000,
);

test(
  "commitlint config refuses a by-name Dependabot title that counts one directory, which Dependabot writes only for two or more",
  async () => {
    for (const title of ["build(deps): Bump business across 1 directory", "build(deps): Bump business across 1 directory (#3)"]) {
      const red = await lint(title);
      expect({ title, exitCode: red.exitCode === 0 ? 0 : 1, flagged: red.text.includes("[subject-case]") }).toEqual({
        title,
        exitCode: 1,
        flagged: true,
      });
    }
  },
  120_000,
);

test(
  "commitlint config rejects the retired house prefixes, unknown types and long headers",
  async () => {
    const retired = [
      "theme",
      "renamer",
      "shell",
      "pi",
      "home",
      "audit",
      "comments",
      "unslop",
    ];
    for (const type of retired) {
      const refused = await lint(`${type}(scope): add x`);
      expect(refused.exitCode).not.toBe(0);
      expect(refused.text).toContain("[type-enum]");
    }
    const red = await lint("frobnicate(scope): add x");
    expect(red.exitCode).not.toBe(0);
    expect(red.text).toContain("[type-enum]");
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
  "the title bin passes the title Dependabot writes for its own update, which is the pull request title CI lints",
  async () => {
    const lintTitle = titleLinter(process.env["PATH"] ?? "");
    expect(await lintTitle("build(deps): Bump actions/checkout from 5.1.0 to 7.0.1")).toEqual({ exitCode: 0, text: "" });
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function titleStatusSteps(): Promise<readonly Record<string, unknown>[]> {
  const workflow: unknown = Bun.YAML.parse(await Bun.file(join(CHECKOUT, ".github", "workflows", "ci.yml")).text());
  const jobs = isRecord(workflow) ? workflow["jobs"] : undefined;
  const steps = isRecord(jobs) ? Object.values(jobs).flatMap((job) => (isRecord(job) && Array.isArray(job["steps"]) ? job["steps"] : [])) : [];
  return steps.filter(
    (step): step is Record<string, unknown> =>
      isRecord(step) && typeof step["uses"] === "string" && step["uses"].startsWith("avi2d/workflows/commitlint-status@"),
  );
}

test(
  "the ci job always posts the title outcome as a commitlint status on pull_request and dispatch alike",
  async () => {
    const [step, ...others] = await titleStatusSteps();
    expect(others).toEqual([]);
    if (step === undefined || !isRecord(step["with"])) throw new Error("no step reports the title outcome");
    expect(step["if"]).toBe("always()");
    expect(step["uses"]).toBe("avi2d/workflows/commitlint-status@v1");
    expect(step["with"]).toEqual({ outcome: "${{ steps.title.outcome }}" });
  },
  60_000,
);
