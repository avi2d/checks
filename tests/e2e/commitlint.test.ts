import { $ } from "bun";
import { expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { commitlintWorkflow } from "../../scripts/quality.ts";
import { lastStep, parseWorkflow } from "../lib/workflow.ts";
import { CHECKOUT, ran, type Ran } from "./lib/fixture-repo.ts";

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
    const header = `feat(scope): ${"x".repeat(101 - "feat(scope): ".length)}`;
    expect(header.length).toBe(101);
    const long = await lint(header);
    expect(long.exitCode).not.toBe(0);
  },
  120_000,
);

test(
  "the generated title-lint step rejects a title that starts with git's comment character",
  async () => {
    const step = lastStep(parseWorkflow(commitlintWorkflow("./commitlint.config.js")));
    const runnerTemp = await mkdtemp(join(tmpdir(), "checks-commitlint-hash-guard-"));
    await writeFile(join(runnerTemp, "pr-title"), "# not a conventional title at all (#0000)");

    const red = await ran($`${{ raw: step.run }}`.cwd(CHECKOUT).env({ ...process.env, ...step.env, RUNNER_TEMP: runnerTemp }));
    expect(red.exitCode).not.toBe(0);
  },
  60_000,
);
