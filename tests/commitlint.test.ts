import { $ } from "bun";
import { expect, test } from "bun:test";
import { join, resolve } from "node:path";

const CHECKOUT = resolve(import.meta.dir, "..");

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
