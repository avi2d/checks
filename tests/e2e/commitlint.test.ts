import { $ } from "bun";
import { expect, test } from "bun:test";
import { symlink } from "node:fs/promises";
import { join } from "node:path";
import { withoutPullRequestEvent } from "../lib/env.ts";
import { CHECKOUT, ran, scratchDirs, type Ran } from "./lib/fixture-repo.ts";

const scratch = scratchDirs();
const BIN = join(CHECKOUT, "src", "delivery", "commit-title.ts");

function lint(message: string): Promise<Ran> {
  const binary = join(CHECKOUT, "node_modules", ".bin", "commitlint");
  const config = join(CHECKOUT, "commitlint.config.js");
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
      "herdr",
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
