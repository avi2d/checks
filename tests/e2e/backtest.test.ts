import { $ } from "bun";
import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const CHECKOUT = resolve(import.meta.dir, "..", "..");
const SCRIPT = join(CHECKOUT, "scripts", "backtest.ts");

let dir = "";

afterEach(async () => {
  if (dir !== "") {
    await rm(dir, { recursive: true, force: true });
    dir = "";
  }
});

async function commit(message: string): Promise<void> {
  await $`git add -A && git commit -q --no-gpg-sign -m ${message}`.cwd(dir).quiet();
}

test(
  "the backtest attributes each refusal to the commit that introduced it",
  async () => {
    dir = await mkdtemp(join(tmpdir(), "checks-backtest-"));
    await $`git init -q -b main`.cwd(dir).quiet();
    await $`git config user.name tester && git config user.email tester@example.com`.cwd(dir).quiet();

    await writeFile(join(dir, "a.ts"), "export const one = 1;\n");
    await commit("clean start");
    await writeFile(join(dir, "a.ts"), "export const one = 1;\n// @ts-expect-error silenced\n");
    await commit("plant a violation");
    await writeFile(join(dir, "b.ts"), "export const two = 2;\n");
    await commit("unrelated change");

    const result = await $`bun ${SCRIPT} 10`.cwd(dir).nothrow().quiet();
    const text = result.stdout.toString();
    expect(result.exitCode).toBe(0);
    expect(text).toContain("refusals introduced: 1");
    expect(text).toContain("plant a violation");
    expect(text).toContain("a.ts:2 carries the machine-read directive `@ts-expect-error`");
  },
  120_000,
);
