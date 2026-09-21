import { $ } from "bun";
import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const CHECKOUT = resolve(import.meta.dir, "..");
const SCRIPT = join(CHECKOUT, "scripts", "lint-coverage.sh");
const OXLINT = join(CHECKOUT, "node_modules", ".bin", "oxlint");
const PLANT = "src/skipped.ts";

let dir = "";

async function coverage(): Promise<{ exitCode: number; text: string }> {
  const result = await $`${SCRIPT}`
    .cwd(dir)
    .env({ ...process.env, OXLINT_BIN: OXLINT })
    .nothrow()
    .quiet();
  return {
    exitCode: result.exitCode,
    text: result.stdout.toString() + result.stderr.toString(),
  };
}

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "checks-lint-coverage-"));
  await $`mkdir -p src`.cwd(dir).quiet();
  await writeFile(join(dir, "src", "linted.ts"), "export const a = 1;\n");
  await writeFile(join(dir, PLANT), "export const b = 2;\n");
  await writeFile(join(dir, ".gitignore"), "");
  await $`git init -q && git add -A`.cwd(dir).quiet();
});

afterAll(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
});

test(
  "lint-coverage goes red on a gitignored tracked file, green once it is restored",
  async () => {
    await writeFile(join(dir, ".gitignore"), `${PLANT}\n`);
    const red = await coverage();
    expect(red.exitCode).not.toBe(0);
    expect(red.text).toContain(PLANT);

    await writeFile(join(dir, ".gitignore"), "");
    const green = await coverage();
    expect(green.exitCode).toBe(0);
    expect(green.text).toContain("2/2");
  },
  60_000,
);
