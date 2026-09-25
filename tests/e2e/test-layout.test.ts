import { $ } from "bun";
import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CHECKOUT, ran, UNVENDORED_BUNFIG, type Ran } from "./lib/fixture-repo.ts";

const CHECK = join(CHECKOUT, "scripts", "test-layout.ts");
const PRESET = join(CHECKOUT, "bunfig.toml");

const MANIFEST = {
  name: "consumer",
  scripts: {
    test: "checks-test",
    lint: "oxlint && bun ./node_modules/@avi2dg/checks/scripts/test-layout.ts",
  },
};
const LIBRARIES = {
  sources: { libraries: [{ name: "fake-lib", package: "fake-lib", repository: "https://example.com/o/fake-lib.git", tag: "v{version}" }] },
};
const CLEAN_TEST = 'import { expect, test } from "bun:test";\ntest("adds", () => {\n  expect(1 + 1).toBe(2);\n});\n';

let dir = "";

async function layout(stage = true): Promise<Ran> {
  if (stage) await $`git add -A`.cwd(dir).quiet();
  return ran($`bun ${CHECK} ${dir}`.cwd(dir));
}

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "checks-test-layout-"));
  await mkdir(join(dir, "src"), { recursive: true });
  await mkdir(join(dir, "tests", "e2e"), { recursive: true });
  await writeFile(join(dir, "package.json"), `${JSON.stringify(MANIFEST, null, 2)}\n`);
  await writeFile(join(dir, "bunfig.toml"), UNVENDORED_BUNFIG);
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

    await writeFile(join(dir, "bunfig.toml"), "[test]\npathIgnorePatterns = []\n");
    const drifted = await layout();
    expect(drifted.exitCode).toBe(1);
    expect(drifted.text).toContain('[test].pathIgnorePatterns must be ["**/tests/quarantine/**"]');
    expect(drifted.text).toContain("the check pins it");

    await writeFile(join(dir, "bunfig.toml"), UNVENDORED_BUNFIG);
    const green = await layout();
    expect(green.exitCode).toBe(0);
    expect(green.text).toContain("satisfy the layout");

    await writeFile(join(dir, "quality.json"), JSON.stringify(LIBRARIES));
    const vendoring = await layout();
    expect(vendoring.exitCode).toBe(1);
    expect(vendoring.text).toContain('[test].pathIgnorePatterns must be ["**/tests/quarantine/**","repos/**"]');

    await writeFile(join(dir, "bunfig.toml"), await readFile(PRESET, "utf8"));
    expect((await layout()).exitCode).toBe(0);
  },
  60_000,
);

test(
  "the layout check sees an unstaged new violation and survives a tracked file removed from disk",
  async () => {
    expect((await layout()).exitCode).toBe(0);

    await writeFile(join(dir, "src", "unstaged.test.ts"), CLEAN_TEST);
    const unstaged = await layout(false);
    expect(unstaged.exitCode).toBe(1);
    expect(unstaged.text).toContain("src/unstaged.test.ts: a test file must live at tests/**/*.test.ts");
    await rm(join(dir, "src", "unstaged.test.ts"));

    await rm(join(dir, "tests", "widget.test.ts"));
    const removed = await layout(false);
    expect(removed.exitCode).toBe(0);
    expect(removed.text).toContain("satisfy the layout");

    await writeFile(join(dir, "tests", "widget.test.ts"), CLEAN_TEST);
    expect((await layout()).exitCode).toBe(0);
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
      expect(text).toContain('scripts.test must be exactly "checks-test"');
      expect(text).toContain("scripts.lint must run the layout check");
      expect(text).toContain("bunfig.toml is missing");
    } finally {
      await rm(bare, { recursive: true, force: true });
    }
  },
  60_000,
);
