import { $ } from "bun";
import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const CHECKOUT = resolve(import.meta.dir, "..", "..");
const SCRIPT = join(CHECKOUT, "scripts", "lint-coverage.sh");
const BIN = join(CHECKOUT, "node_modules", ".bin");
const SYSTEM_PATH = "/usr/bin:/bin";
const PLANT = "src/skipped.ts";

let dir = "";

async function coverage(path = `${BIN}:${process.env.PATH ?? ""}`): Promise<{ exitCode: number; text: string }> {
  const result = await $`${SCRIPT}`
    .cwd(dir)
    .env({ ...process.env, PATH: path })
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
  await writeFile(join(dir, "src", "also-linted.ts"), "export const c = 3;\n");
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
    expect(red.exitCode).toBe(1);
    expect(red.text).toContain("skips 1/3");
    expect(red.text).toContain(PLANT);

    await writeFile(join(dir, ".gitignore"), "");
    const green = await coverage();
    expect(green.exitCode).toBe(0);
    expect(green.text).toContain("3/3");
  },
  60_000,
);

test(
  "lint-coverage cannot decide without oxlint on PATH",
  async () => {
    const undecided = await coverage(SYSTEM_PATH);
    expect(undecided.exitCode).toBe(2);
    expect(undecided.text).toContain("oxlint could not walk the tree");
    expect(undecided.text).toContain("not found");
  },
  60_000,
);

test(
  "lint-coverage cannot decide when oxlint cannot read its config, and decides once it can",
  async () => {
    await writeFile(join(dir, ".oxlintrc.json"), "{ broken");
    const undecided = await coverage();
    await rm(join(dir, ".oxlintrc.json"));
    expect(undecided.exitCode).toBe(2);
    expect(undecided.text).toContain("Failed to parse oxlint config");

    expect((await coverage()).exitCode).toBe(0);
  },
  60_000,
);
