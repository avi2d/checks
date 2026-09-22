import { $ } from "bun";
import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const CHECKOUT = resolve(import.meta.dir, "..", "..");
const CHECK = join(CHECKOUT, "scripts", "test-layout.ts");
const PRESET = join(CHECKOUT, "bunfig.toml");

const MANIFEST = {
  name: "consumer",
  scripts: {
    test: "bun test --randomize",
    lint: "oxlint && bun ./node_modules/@avi2d/checks/scripts/test-layout.ts",
  },
};
const CLEAN_TEST = 'import { expect, test } from "bun:test";\ntest("adds", () => {\n  expect(1 + 1).toBe(2);\n});\n';

let dir = "";

async function layout(): Promise<{ exitCode: number; text: string }> {
  await $`git add -A`.cwd(dir).quiet();
  const result = await $`bun ${CHECK} ${dir}`.cwd(dir).nothrow().quiet();
  return { exitCode: result.exitCode, text: result.stdout.toString() + result.stderr.toString() };
}

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "checks-test-layout-"));
  await mkdir(join(dir, "src"), { recursive: true });
  await mkdir(join(dir, "tests", "e2e"), { recursive: true });
  await writeFile(join(dir, "package.json"), `${JSON.stringify(MANIFEST, null, 2)}\n`);
  await writeFile(join(dir, "bunfig.toml"), await readFile(PRESET, "utf8"));
  await writeFile(join(dir, "src", "widget.ts"), "export const widget = 1;\n");
  await writeFile(join(dir, "tests", "widget.test.ts"), CLEAN_TEST);
  await writeFile(join(dir, ".gitignore"), "node_modules/\n");
  await $`git init -q`.cwd(dir).quiet();
});

afterAll(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
});

test(
  "the layout check goes red on a colocated test, on a spawn outside e2e, on a drifted bunfig, and green once each is fixed",
  async () => {
    const clean = await layout();
    expect(clean.exitCode).toBe(0);
    expect(clean.text).toContain("satisfy the layout");

    await writeFile(join(dir, "src", "widget.test.ts"), CLEAN_TEST);
    const colocated = await layout();
    expect(colocated.exitCode).toBe(1);
    expect(colocated.text).toContain("src/widget.test.ts: a test file must live at tests/**/*.test.ts");
    expect(colocated.text).toContain("move it to tests/widget.test.ts");
    await rm(join(dir, "src", "widget.test.ts"));

    await writeFile(
      join(dir, "tests", "widget.test.ts"),
      `import { spawnSync } from "node:child_process";\n${CLEAN_TEST}`,
    );
    const spawned = await layout();
    expect(spawned.exitCode).toBe(1);
    expect(spawned.text).toContain("tests/widget.test.ts:1: a test outside tests/e2e/ must stay in-process");
    expect(spawned.text).toContain("imports node:child_process");
    expect(spawned.text).toContain("move it to tests/e2e/widget.test.ts");

    await writeFile(join(dir, "tests", "e2e", "widget.test.ts"), `import { spawnSync } from "node:child_process";\n${CLEAN_TEST}`);
    await writeFile(join(dir, "tests", "widget.test.ts"), CLEAN_TEST);
    expect((await layout()).exitCode).toBe(0);

    await writeFile(join(dir, "bunfig.toml"), "[test]\nrandomize = false\n");
    const drifted = await layout();
    expect(drifted.exitCode).toBe(1);
    expect(drifted.text).toContain("[test].randomize must be true");
    expect(drifted.text).toContain("bun has no bunfig extends");

    await writeFile(join(dir, "bunfig.toml"), await readFile(PRESET, "utf8"));
    const green = await layout();
    expect(green.exitCode).toBe(0);
    expect(green.text).toContain("satisfy the layout");
  },
  60_000,
);

test(
  "the layout check names a missing bunfig and the wrong test script",
  async () => {
    const bare = await mkdtemp(join(tmpdir(), "checks-test-layout-bare-"));
    try {
      await writeFile(join(bare, "package.json"), `${JSON.stringify({ name: "bare", scripts: { test: "bun test" } }, null, 2)}\n`);
      await $`git init -q && git add -A`.cwd(bare).quiet();
      const result = await $`bun ${CHECK} ${bare}`.cwd(bare).nothrow().quiet();
      const text = result.stdout.toString() + result.stderr.toString();
      expect(result.exitCode).toBe(1);
      expect(text).toContain('scripts.test must be exactly "bun test --randomize"');
      expect(text).toContain("scripts.lint must run the layout check");
      expect(text).toContain("bunfig.toml is missing");
    } finally {
      await rm(bare, { recursive: true, force: true });
    }
  },
  60_000,
);
