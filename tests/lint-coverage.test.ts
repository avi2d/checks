import { $ } from "bun";
import { expect, test } from "bun:test";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const CHECKOUT = resolve(import.meta.dir, "..");
const GITIGNORE = join(CHECKOUT, ".gitignore");
const PLANT = "tests/tsconfig-effect.test.ts";

async function coverage(): Promise<{ exitCode: number; text: string }> {
  const result =
    await $`./scripts/lint-coverage.sh --type-aware`.cwd(CHECKOUT).nothrow().quiet();
  return {
    exitCode: result.exitCode,
    text: result.stdout.toString() + result.stderr.toString(),
  };
}

test(
  "lint-coverage goes red on a gitignored tracked file, green once it is restored",
  async () => {
    const original = await readFile(GITIGNORE, "utf8");
    try {
      await writeFile(GITIGNORE, `${original}${PLANT}\n`);
      const red = await coverage();
      expect(red.exitCode).not.toBe(0);
      expect(red.text).toContain(PLANT);
    } finally {
      await writeFile(GITIGNORE, original);
    }

    const green = await coverage();
    expect(green.exitCode).toBe(0);
  },
  120_000,
);
