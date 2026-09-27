import { $ } from "bun";
import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CHECKOUT, fixtureRepos, ran, UNVENDORED_BUNFIG, type Ran } from "./lib/fixture-repo.ts";

const CHECK = join(CHECKOUT, "src", "testing", "test-layout.ts");
const PRESET = join(CHECKOUT, "bunfig.toml");

const MANIFEST = {
  name: "consumer",
  scripts: {
    test: "checks-test",
    lint: "oxlint && bun ./node_modules/@avi2dg/checks/src/testing/test-layout.ts",
  },
};
const CLEAN_TEST = 'import { expect, test } from "bun:test";\ntest("adds", () => {\n  expect(1 + 1).toBe(2);\n});\n';
const FAILING_SPAWN = 'import { spawnSync } from "node:child_process";\nimport { expect, test } from "bun:test";\ntest("flakes", () => {\n  expect(spawnSync("true").status).toBe(1);\n});\n';
const quarantined = fixtureRepos("checks-test-layout-quarantine-");

let dir = "";

async function layout(stage = true): Promise<Ran> {
  if (stage) await $`git add -A`.cwd(dir).quiet();
  return ran($`bun ${CHECK} ${dir}`.cwd(dir));
}

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "checks-test-layout-"));
  await mkdir(join(dir, "src"), { recursive: true });
  await mkdir(join(dir, "tests", "e2e"), { recursive: true });
  await mkdir(join(dir, "tests", "unit"), { recursive: true });
  await writeFile(join(dir, "package.json"), `${JSON.stringify(MANIFEST, null, 2)}\n`);
  await writeFile(join(dir, "bunfig.toml"), UNVENDORED_BUNFIG);
  await writeFile(join(dir, "src", "widget.ts"), "export const widget = 1;\n");
  await writeFile(join(dir, "tests", "unit", "widget.test.ts"), CLEAN_TEST);
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
    expect(colocated.text).toContain("src/widget.test.ts: a test file must live at tests/<level>/**/*.test.ts");
    expect(colocated.text).toContain("move it to tests/unit/widget.test.ts");
    await rm(join(dir, "src", "widget.test.ts"));

    await writeFile(join(dir, "tests", "flat.test.ts"), CLEAN_TEST);
    const flat = await layout();
    expect(flat.exitCode).toBe(1);
    expect(flat.text).toContain("tests/flat.test.ts: a test file must live at tests/<level>/**/*.test.ts");
    expect(flat.text).toContain("move it to tests/unit/flat.test.ts");
    await rm(join(dir, "tests", "flat.test.ts"));

    await writeFile(
      join(dir, "tests", "unit", "widget.test.ts"),
      `import { spawnSync } from "node:child_process";\n${CLEAN_TEST}`,
    );
    const spawned = await layout();
    expect(spawned.exitCode).toBe(1);
    expect(spawned.text).toContain("tests/unit/widget.test.ts:1: a test outside tests/e2e/ must stay in-process");
    expect(spawned.text).toContain("imports node:child_process");
    expect(spawned.text).toContain("move it to tests/e2e/widget.test.ts");

    await writeFile(join(dir, "tests", "e2e", "widget.test.ts"), `import { spawnSync } from "node:child_process";\n${CLEAN_TEST}`);
    await writeFile(join(dir, "tests", "unit", "widget.test.ts"), CLEAN_TEST);
    expect((await layout()).exitCode).toBe(0);

    await writeFile(join(dir, "bunfig.toml"), "[test]\npathIgnorePatterns = []\n");
    const drifted = await layout();
    expect(drifted.exitCode).toBe(1);
    expect(drifted.text).toContain('[test].pathIgnorePatterns must be ["**/tests/quarantine/**","**/tests/live/**","**/tests/pixel/**","repos/**"] or ["**/tests/quarantine/**","**/tests/live/**","**/tests/pixel/**"]');
    expect(drifted.text).toContain("the check pins it");

    await writeFile(join(dir, "bunfig.toml"), UNVENDORED_BUNFIG);
    const green = await layout();
    expect(green.exitCode).toBe(0);
    expect(green.text).toContain("satisfy the layout");

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
    expect(unstaged.text).toContain("src/unstaged.test.ts: a test file must live at tests/<level>/**/*.test.ts");
    await rm(join(dir, "src", "unstaged.test.ts"));

    await rm(join(dir, "tests", "unit", "widget.test.ts"));
    const removed = await layout(false);
    expect(removed.exitCode).toBe(0);
    expect(removed.text).toContain("satisfy the layout");

    await writeFile(join(dir, "tests", "unit", "widget.test.ts"), CLEAN_TEST);
    expect((await layout()).exitCode).toBe(0);
  },
  60_000,
);

test(
  "test tier directories require matching package scripts and may spawn processes",
  async () => {
    const repos = fixtureRepos("checks-test-layout-tiers-");
    const spawning = `import { $ } from "bun";\nimport { spawnSync } from "node:child_process";\n${CLEAN_TEST}`;
    const repo = await repos({
      "package.json": `${JSON.stringify(MANIFEST, null, 2)}\n`,
      "bunfig.toml": UNVENDORED_BUNFIG,
      "tests/live/machine.test.ts": spawning,
      "tests/pixel/display.test.ts": spawning,
    });

    const missing = await repo.script("testing/test-layout.ts", repo.dir);
    expect(missing.exitCode).toBe(1);
    expect(missing.text).toContain('test:live must be "checks-test --tier=live"');
    expect(missing.text).toContain('test:pixel must be "checks-test --tier=pixel"');

    await repo.write({
      "package.json": `${JSON.stringify(
        { ...MANIFEST, scripts: { ...MANIFEST.scripts, "test:live": "checks-test --tier=live", "test:pixel": "checks-test --tier=pixel" } },
        null,
        2,
      )}\n`,
    });
    const fixed = await repo.script("testing/test-layout.ts", repo.dir);
    expect(fixed.exitCode).toBe(0);
    expect(fixed.text).toContain("satisfy the layout");
  },
  60_000,
);

test(
  "a spawning test quarantines under tests/quarantine/e2e/, which the layout check accepts, the default run skips and the clock counts",
  async () => {
    const repo = await quarantined({
      "package.json": `${JSON.stringify(MANIFEST, null, 2)}\n`,
      "bunfig.toml": UNVENDORED_BUNFIG,
      "tests/unit/widget.test.ts": CLEAN_TEST,
      "tests/quarantine/e2e/flaky.test.ts": FAILING_SPAWN,
    });

    const accepted = await repo.script("testing/test-layout.ts", repo.dir);
    expect(accepted.text).toContain("satisfy the layout");
    expect(accepted.exitCode).toBe(0);

    const suite = await ran($`bun test`.cwd(repo.dir));
    expect(suite.text).not.toContain("flaky");
    expect(suite.exitCode).toBe(0);

    await repo.commit("test: quarantine the flaky spawn");
    const clock = await repo.script("testing/quarantine-clock.ts", "HEAD");
    expect(clock.text).toContain("(1 checked)");

    await repo.write({
      "tests/quarantine/unit/spawner.test.ts": FAILING_SPAWN,
      "tests/quarantine/loose.test.ts": CLEAN_TEST,
      "tests/e2e/quarantine/hidden.test.ts": CLEAN_TEST,
    });
    const refused = await repo.script("testing/test-layout.ts", repo.dir);
    expect(refused.exitCode).toBe(1);
    expect(refused.text).toContain("tests/quarantine/unit/spawner.test.ts:1: a test outside tests/e2e/ must stay in-process");
    expect(refused.text).toContain("move it to tests/quarantine/e2e/spawner.test.ts");
    expect(refused.text).toContain("tests/quarantine/loose.test.ts: a quarantined test keeps its level");
    expect(refused.text).toContain("move it to tests/quarantine/unit/loose.test.ts");
    expect(refused.text).toContain("tests/e2e/quarantine/hidden.test.ts: a quarantined test keeps its level");
    expect(refused.text).toContain("move it to tests/quarantine/e2e/hidden.test.ts");
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
