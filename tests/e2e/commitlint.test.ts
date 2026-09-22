import { $ } from "bun";
import { expect, test } from "bun:test";
import { join, resolve } from "node:path";

const CHECKOUT = resolve(import.meta.dir, "..", "..");

async function lint(message: string): Promise<{ exitCode: number; text: string }> {
  const binary = join(CHECKOUT, "node_modules", ".bin", "commitlint");
  const config = join(CHECKOUT, "commitlint.config.js");
  const result = await $`printf '%s' ${message} | ${binary} --config ${config}`
    .nothrow()
    .quiet();
  return {
    exitCode: result.exitCode,
    text: result.stdout.toString() + result.stderr.toString(),
  };
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
  "commitlint config rejects a Co-authored-by trailer",
  async () => {
    const red = await lint("feat(lint): add x\n\nCo-authored-by: David Guseinov <tech@hexn.io>\n");
    expect(red.exitCode).not.toBe(0);
    expect(red.text).toContain("no-co-authored-by");

    const green = await lint("feat(lint): add x\n\nA body with no trailer.\n");
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
