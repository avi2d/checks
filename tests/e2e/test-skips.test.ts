import { $ } from "bun";
import { expect, test } from "bun:test";
import { mkdir, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { CHECKOUT, ran, scratchDirs, type Ran } from "./lib/fixture-repo.ts";

const SCRIPT = join(CHECKOUT, "scripts", "test.ts");
const BUNFIG = '[test]\npathIgnorePatterns = ["**/tests/quarantine/**", "**/tests/live/**", "**/tests/pixel/**"]\n';

const scratch = scratchDirs();
let dir = "";

async function consumer(suite: string, files: Readonly<Record<string, string>> = {}): Promise<void> {
  dir = await scratch("checks-test-skips-");
  await mkdir(join(dir, "tests"), { recursive: true });
  await writeFile(join(dir, "tests", "suite.test.ts"), suite);
  for (const [file, source] of Object.entries(files)) {
    const target = join(dir, file);
    await mkdir(join(target, ".."), { recursive: true });
    await writeFile(target, source);
  }
  await writeFile(join(dir, "package.json"), JSON.stringify({ name: "consumer", scripts: { test: "checks-test" } }));
  await writeFile(join(dir, "bunfig.toml"), BUNFIG);
  const scope = join(dir, "node_modules", "@avi2dg");
  await mkdir(scope, { recursive: true });
  await symlink(CHECKOUT, join(scope, "checks"), "dir");
}

function checksTest(ci: boolean, args: readonly string[] = []): Promise<Ran> {
  const { CI: _ci, ...env } = process.env;
  return ran($`bun ${SCRIPT} ${args}`.cwd(dir).env(ci ? { ...env, CI: "true" } : env));
}

test("a reason at the test site passes without a package declaration", async () => {
  await consumer(
    'import { expect, test } from "bun:test";\nimport { skipReason } from "@avi2dg/checks/scripts/test-skips.ts";\ntest.skipIf(true)(skipReason("waits for the rounding fix", "rounds half to even"), () => expect(1).toBe(1));\n',
  );
  await writeFile(
    join(dir, "package.json"),
    JSON.stringify({
      name: "consumer",
      scripts: { test: "checks-test" },
      testSkips: [{ file: "tests/missing.test.ts", test: "removed", reason: "ignored legacy data" }],
    }),
  );

  const declared = await checksTest(false);
  expect(declared.exitCode).toBe(0);
  expect(declared.text).toContain("checks-test: 1 skipped test(s), each declared at its test site");
});

test("a dynamic skip reason is refused before the suite runs", async () => {
  await consumer(
    'import { expect, test } from "bun:test";\nimport { skipReason } from "@avi2dg/checks/scripts/test-skips.ts";\nconst reason = "waits for the rounding fix";\ntest.skipIf(true)(skipReason(reason, "rounds half to even"), () => expect(1).toBe(1));\n',
  );

  const refused = await checksTest(false);
  expect(refused.exitCode).toBe(2);
  expect(refused.text).toContain("skipReason needs a non-empty literal reason and a literal test name");
});

test("test.skip can declare its reason at the test site", async () => {
  await consumer(
    'import { expect, test } from "bun:test";\nimport { skipReason } from "@avi2dg/checks/scripts/test-skips.ts";\ntest.skip(skipReason("needs the external fixture", "loads the fixture"), () => expect(1).toBe(1));\n',
  );

  const declared = await checksTest(false);
  expect(declared.exitCode).toBe(0);
  expect(declared.text).toContain("checks-test: 1 skipped test(s), each declared at its test site");
});

test("a skip wrapped across lines is declared at the line Bun reports", async () => {
  await consumer(
    [
      'import { expect, test } from "bun:test";',
      'import { skipReason } from "@avi2dg/checks/scripts/test-skips.ts";',
      "test.skipIf(true)(",
      '  skipReason("waits for the rounding fix", "wraps its arguments"),',
      "  () => expect(1).toBe(1),",
      ");",
      "test.skip(",
      '  skipReason("needs the external fixture", "wraps an unconditional skip"),',
      "  () => expect(1).toBe(1),",
      ");",
      "test.skipIf(",
      "  true,",
      ')(skipReason("CI has no daemon", "wraps its condition"), () => expect(1).toBe(1));',
      "",
    ].join("\n"),
  );

  const declared = await checksTest(true);
  expect(declared.exitCode).toBe(0);
  expect(declared.text).toContain("checks-test: 3 skipped test(s), each declared at its test site");
});

test("a declaration on a skipped describe covers every test inside it", async () => {
  await consumer(
    [
      'import { describe, expect, test } from "bun:test";',
      'import { skipReason } from "@avi2dg/checks/scripts/test-skips.ts";',
      'describe.skip(skipReason("needs the external fixture", "fixture group"), () => {',
      '  test("loads the fixture", () => expect(1).toBe(1));',
      '  test("reads the fixture", () => expect(1).toBe(1));',
      "});",
      'describe.skipIf(true)(skipReason("CI has no daemon", "daemon group"), () => {',
      '  describe("nested", () => {',
      '    test("reaches the daemon", () => expect(1).toBe(1));',
      "  });",
      "});",
      'test("still runs", () => expect(1).toBe(1));',
      "",
    ].join("\n"),
  );

  const declared = await checksTest(true);
  expect(declared.exitCode).toBe(0);
  expect(declared.text).toContain("checks-test: 3 skipped test(s), each declared at its test site");
});

test("a declared todo passes", async () => {
  await consumer(
    'import { test } from "bun:test";\nimport { skipReason } from "@avi2dg/checks/scripts/test-skips.ts";\ntest.todo(skipReason("needs the tax table", "applies tax"));\n',
  );

  const declared = await checksTest(true);
  expect(declared.exitCode).toBe(0);
  expect(declared.text).toContain("checks-test: 1 skipped test(s), each declared at its test site");
});

test("a native skip without a reason and an undeclared todo fail", async () => {
  await consumer(
    'import { expect, test } from "bun:test";\ntest.skip("uses the unavailable daemon", () => expect(1).toBe(1));\ntest.todo("refunds a partial order");\n',
  );

  const refused = await checksTest(false);
  expect(refused.exitCode).toBe(1);
  expect(refused.text).toContain("uses the unavailable daemon: skipped with no reason at its test site");
  expect(refused.text).toContain("refunds a partial order: a todo with no reason at its test site");
});

test("a declaration whose test stopped skipping fails in CI and warns locally", async () => {
  await consumer(
    'import { expect, test } from "bun:test";\nimport { skipReason } from "@avi2dg/checks/scripts/test-skips.ts";\ntest.skipIf(false)(skipReason("waits for the rounding fix", "rounds half to even"), () => expect(1).toBe(1));\n',
  );

  const ci = await checksTest(true);
  expect(ci.exitCode).toBe(1);
  expect(ci.text).toContain("no test skipped with this declaration; reason: waits for the rounding fix");
  const local = await checksTest(false);
  expect(local.exitCode).toBe(0);
  expect(local.text).toContain("warning: 1 declaration(s) matching no skipped test");
});

test("a declaration whose registration no longer exists fails in CI and warns locally", async () => {
  await consumer(
    'import { expect, test } from "bun:test";\nimport { skipReason } from "@avi2dg/checks/scripts/test-skips.ts";\nif (false) { test.skipIf(true)(skipReason("the fixture was removed", "removed fixture"), () => expect(1).toBe(1)); }\ntest("still runs", () => expect(1).toBe(1));\n',
  );

  const ci = await checksTest(true);
  expect(ci.exitCode).toBe(1);
  expect(ci.text).toContain("the fixture was removed");
  const local = await checksTest(false);
  expect(local.exitCode).toBe(0);
  expect(local.text).toContain("warning: 1 declaration(s) matching no skipped test");
});

test("a declaration applies only to its selected environment", async () => {
  await consumer(
    'import { expect, test } from "bun:test";\nimport { skipReason } from "@avi2dg/checks/scripts/test-skips.ts";\ntest.skipIf(Boolean(process.env.CI))(skipReason("CI has no daemon", "reaches the local daemon", "ci"), () => expect(1).toBe(1));\n',
  );

  const ci = await checksTest(true);
  expect(ci.exitCode).toBe(0);
  expect(ci.text).toContain("1 skipped test(s), each declared at its test site");
  const local = await checksTest(false);
  expect(local.exitCode).toBe(0);
  expect(local.text).toContain("1 declaration(s) for ci not judged in this local run");
});

test("the default run excludes live tests and the live and pixel tiers judge only their own directory", async () => {
  await consumer('import { expect, test } from "bun:test";\ntest("default test", () => expect(1).toBe(1));\n', {
    "tests/live-reload.test.ts": 'import { expect, test } from "bun:test";\nimport { skipReason } from "@avi2dg/checks/scripts/test-skips.ts";\ntest.skipIf(true)(skipReason("waits for the reload fix", "reloads the page"), () => expect(1).toBe(1));\n',
    "tests/live/machine.test.ts": 'import { expect, test } from "bun:test";\nimport { skipReason } from "@avi2dg/checks/scripts/test-skips.ts";\ntest.skipIf(true)(skipReason("requires a local daemon", "connects to the daemon"), () => expect(1).toBe(1));\n',
    "tests/pixel/screen.test.ts": 'import { expect, test } from "bun:test";\nimport { skipReason } from "@avi2dg/checks/scripts/test-skips.ts";\ntest.skipIf(true)(skipReason("requires a live display", "renders the screen"), () => expect(1).toBe(1));\n',
  });

  const defaultRun = await checksTest(false);
  expect(defaultRun.exitCode).toBe(0);
  expect(defaultRun.text).toContain("checks-test: 1 skipped test(s), each declared at its test site");

  const liveRun = await checksTest(false, ["--tier=live"]);
  expect(liveRun.exitCode).toBe(0);
  expect(liveRun.text).toContain("checks-test: 1 skipped test(s), each declared at its test site");

  const pixelRun = await checksTest(false, ["--tier=pixel"]);
  expect(pixelRun.exitCode).toBe(0);
  expect(pixelRun.text).toContain("checks-test: 1 skipped test(s), each declared at its test site");
});
