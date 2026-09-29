import { $ } from "bun";
import { expect, test } from "bun:test";
import { symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseWorkflow, stepNamed } from "../lib/workflow.ts";
import { CHECKOUT, ran, type Ran, scratchDirs } from "./lib/fixture-repo.ts";

const scratch = scratchDirs();

function lint(message: string): Promise<Ran> {
  const binary = join(CHECKOUT, "node_modules", ".bin", "commitlint");
  const config = join(CHECKOUT, "commitlint.config.js");
  return ran($`printf '%s' ${message} | ${binary} --config ${config}`);
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

async function titleLinter(prefix: string, path: string): Promise<(title: string) => Promise<Ran>> {
  const step = stepNamed(parseWorkflow(await Bun.file(join(CHECKOUT, ".github/workflows/commitlint.yml")).text()), "lint the title");
  const runnerTemp = await scratch(prefix);
  return async (title) => {
    await writeFile(join(runnerTemp, "pr-title"), title);
    return ran($`${{ raw: step.run }}`.cwd(CHECKOUT).env({ ...process.env, ...step.env, PATH: path, RUNNER_TEMP: runnerTemp }));
  };
}

test(
  "the generated title-lint step rejects a title that starts with git's comment character",
  async () => {
    const lintTitle = await titleLinter("checks-commitlint-hash-guard-", process.env["PATH"] ?? "");

    const red = await lintTitle("# feat(lint): add x (#0000)");
    expect(red.exitCode).not.toBe(0);
    expect(red.text).toContain("[type-empty]");
    expect(red.text).toContain("[subject-empty]");

    const green = await lintTitle("feat(lint): add x (#0000)");
    expect(green.exitCode).toBe(0);
  },
  60_000,
);

test(
  "the generated title-lint step lints under bun on a runner with no node on PATH",
  async () => {
    const bin = await scratch("checks-commitlint-nodeless-bin-");
    const git = Bun.which("git");
    if (git === null) throw new Error("git is not on PATH");
    await symlink(process.execPath, join(bin, "bun"));
    await symlink(git, join(bin, "git"));
    expect(Bun.which("node", { PATH: bin })).toBeNull();
    const lintTitle = await titleLinter("checks-commitlint-nodeless-", bin);

    const red = await lintTitle("update stuff");
    expect(red.exitCode).not.toBe(0);
    expect(red.text).toContain("[type-empty]");

    const green = await lintTitle("feat(lint): add x (#0000)");
    expect(green.text).toBe("");
    expect(green.exitCode).toBe(0);
  },
  60_000,
);
