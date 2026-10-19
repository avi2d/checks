import { $ } from "bun";
import { expect, test } from "bun:test";
import { mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { CHECKOUT, ran, scratchDirs, type Ran } from "./lib/fixture-repo.ts";

const SCRIPT = join(CHECKOUT, "src", "testing", "test.ts");
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

test("a skipReason on a describe is refused before the suite runs", async () => {
  await consumer(
    [
      'import { describe, expect, test } from "bun:test";',
      'import { skipReason } from "@avi2dg/checks/scripts/test-skips.ts";',
      'describe.skipIf(true)(skipReason("needs a display", "screen"), () => {',
      '  test("renders", () => expect(1).toBe(1));',
      "});",
      "",
    ].join("\n"),
  );

  const refused = await checksTest(false);
  expect(refused.exitCode).toBe(2);
  expect(refused.text).toContain(
    "tests/suite.test.ts: line 3: skipReason cannot declare a describe; declare each test inside it with its own skipReason",
  );
});

test("a declared test inside an undeclared skipped describe passes, and an undeclared one fails", async () => {
  const suite = (inner: string) =>
    [
      'import { describe, expect, test } from "bun:test";',
      'import { skipReason } from "@avi2dg/checks/scripts/test-skips.ts";',
      'describe.skip("screen", () => {',
      '  test.skipIf(true)(skipReason("needs a display", "renders"), () => expect(1).toBe(1));',
      inner,
      "});",
      "",
    ].join("\n");
  await consumer(suite(""));
  const declared = await checksTest(true);
  expect(declared.exitCode).toBe(0);
  expect(declared.text).toContain("checks-test: 1 skipped test(s), each declared at its test site");

  await writeFile(join(dir, "tests", "suite.test.ts"), suite('  test("scrolls", () => expect(1).toBe(1));'));
  const refused = await checksTest(true);
  expect(refused.exitCode).toBe(1);
  expect(refused.text).toContain("tests/suite.test.ts:5 screen > scrolls: skipped with no reason at its test site");
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

test("a ci declaration gated on a missing resource skips in CI and is not judged locally", async () => {
  await consumer(
    'import { expect, test } from "bun:test";\nimport { existsSync } from "node:fs";\nimport { skipReason } from "@avi2dg/checks/scripts/test-skips.ts";\ntest.skipIf(!existsSync(new URL("../daemon.sock", import.meta.url)))(skipReason("CI has no daemon", "reaches the local daemon", "ci"), () => expect(1).toBe(1));\n',
  );

  const ci = await checksTest(true);
  expect(ci.exitCode).toBe(0);
  expect(ci.text).toContain("1 skipped test(s), each declared at its test site");

  await writeFile(join(dir, "daemon.sock"), "");
  const local = await checksTest(false);
  expect(local.exitCode).toBe(0);
  expect(local.text).toContain("1 declaration(s) for ci not judged in this local run");
});

test("a ci skip gated on process.env.CI fails a local run as undeclared", async () => {
  await consumer(
    'import { expect, test } from "bun:test";\nimport { skipReason } from "@avi2dg/checks/scripts/test-skips.ts";\ntest.skipIf(Boolean(process.env.CI))(skipReason("CI has no daemon", "reaches the local daemon", "ci"), () => expect(1).toBe(1));\n',
  );

  const ci = await checksTest(true);
  expect(ci.exitCode).toBe(0);
  const local = await checksTest(false);
  expect(local.exitCode).toBe(1);
  expect(local.text).toContain("1 skipped test(s) undeclared in this local run");
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

test("the unit and e2e tiers each run and judge only their own directory", async () => {
  await consumer('import { expect, test } from "bun:test";\ntest("default test", () => expect(1).toBe(1));\n', {
    "tests/unit/widget.test.ts":
      'import { expect, test } from "bun:test";\nimport { skipReason } from "@avi2dg/checks/scripts/test-skips.ts";\ntest.skipIf(true)(skipReason("waits for the split fix", "rounds half to even"), () => expect(1).toBe(1));\n',
    "tests/e2e/flow.test.ts":
      'import { expect, test } from "bun:test";\nimport { skipReason } from "@avi2dg/checks/scripts/test-skips.ts";\ntest.skipIf(true)(skipReason("waits for the split fix", "reaches the daemon"), () => expect(1).toBe(1));\n',
  });

  const unit = await checksTest(true, ["--tier=unit"]);
  expect(unit.exitCode).toBe(0);
  expect(unit.text).toContain("checks-test: 1 skipped test(s), each declared at its test site");

  const e2e = await checksTest(true, ["--tier=e2e"]);
  expect(e2e.exitCode).toBe(0);
  expect(e2e.text).toContain("checks-test: 1 skipped test(s), each declared at its test site");
});

test("a tier run never runs the other tier's files", async () => {
  await consumer('import { expect, test } from "bun:test";\ntest("default test", () => expect(1).toBe(1));\n', {
    "tests/unit/widget.test.ts": 'import { expect, test } from "bun:test";\ntest("breaks the unit tier", () => expect(1).toBe(2));\n',
    "tests/e2e/flow.test.ts": 'import { expect, test } from "bun:test";\ntest("passes the e2e tier", () => expect(1).toBe(1));\n',
  });

  const e2e = await checksTest(true, ["--tier=e2e"]);
  expect(e2e.exitCode).toBe(0);

  const unit = await checksTest(true, ["--tier=unit"]);
  expect(unit.exitCode).toBe(1);
});

test("--junit keeps the report of a failing run at the path it names", async () => {
  await consumer('import { expect, test } from "bun:test";\ntest("breaks on purpose", () => expect(1).toBe(2));\n');

  const failed = await checksTest(true, ["--junit=reports/night/suite.xml"]);

  expect(failed.exitCode).toBe(1);
  const kept = await readFile(join(dir, "reports", "night", "suite.xml"), "utf8");
  expect(kept).toContain('<testcase name="breaks on purpose"');
  expect(kept).toContain("<failure");
});

test("a focused test fails even without CI set, serially and across parallel workers", async () => {
  await consumer(
    'import { expect, test } from "bun:test";\ntest.only("focused passes", () => expect(1).toBe(1));\ntest("failing skipped by only", () => expect(1).toBe(2));\n',
    { "tests/other.test.ts": 'import { expect, test } from "bun:test";\ntest("other passes", () => expect(1).toBe(1));\n' },
  );

  for (const args of [[], ["--parallel=2"]]) {
    const refused = await checksTest(false, args);
    expect(refused.exitCode).toBe(1);
    expect(refused.text).toContain(".only is disabled");
  }
});

// Each file waits long enough that bun starts a second worker, and records the worker that ran it.
function workerFile(body: string): string {
  return [
    'import { expect, test } from "bun:test";',
    'import { appendFileSync } from "node:fs";',
    'import { skipReason } from "@avi2dg/checks/scripts/test-skips.ts";',
    "test(\"records its worker\", async () => {",
    '  appendFileSync(new URL("../workers.txt", import.meta.url), `${process.env["BUN_TEST_WORKER_ID"]}\\n`);',
    "  await Bun.sleep(500);",
    "});",
    body,
    "",
  ].join("\n");
}

async function workersUsed(): Promise<number> {
  return new Set((await readFile(join(dir, "workers.txt"), "utf8")).split("\n").filter(Boolean)).size;
}

test("a declared skip in one parallel worker is judged at its test site", async () => {
  const skip = (condition: boolean) =>
    workerFile(`test.skipIf(${condition})(skipReason("waits for the rounding fix", "rounds half to even"), () => expect(1).toBe(1));`);
  await consumer(workerFile(""), { "tests/pricing.test.ts": skip(true) });

  const declared = await checksTest(true, ["--parallel=2"]);
  expect(declared.exitCode).toBe(0);
  expect(declared.text).toContain("2x PARALLEL");
  expect(declared.text).toContain("checks-test: 1 skipped test(s), each declared at its test site");
  expect(await workersUsed()).toBe(2);

  await writeFile(join(dir, "tests", "pricing.test.ts"), skip(false));
  const stale = await checksTest(true, ["--parallel=2"]);
  expect(stale.exitCode).toBe(1);
  expect(stale.text).toContain("tests/pricing.test.ts:8: no test skipped with this declaration; reason: waits for the rounding fix");
});

test("an undeclared skip in one parallel worker fails the run", async () => {
  await consumer(workerFile(""), {
    "tests/pricing.test.ts": workerFile('test.skip("rounds half to even", () => expect(1).toBe(1));'),
  });

  const refused = await checksTest(true, ["--parallel=2"]);
  expect(refused.exitCode).toBe(1);
  expect(refused.text).toContain("tests/pricing.test.ts:8 rounds half to even: skipped with no reason at its test site");
  expect(await workersUsed()).toBe(2);
});

test("a file whose parallel worker crashed fails the run and leaves its declarations unjudged", async () => {
  await consumer(workerFile(""), {
    "tests/crash.test.ts": workerFile(
      'test.skip(skipReason("needs the external fixture", "loads the fixture"), () => expect(1).toBe(1));\ntest("exits", () => process.exit(3));',
    ),
  });

  const crashed = await checksTest(true, ["--parallel=2"]);
  expect(crashed.exitCode).toBe(1);
  expect(crashed.text).toContain("checks-test: the worker running tests/crash.test.ts crashed, so its skips were not judged");
  expect(crashed.text).not.toContain("no test skipped with this declaration");
});

test("a test filter is refused before the suite runs", async () => {
  await consumer('import { expect, test } from "bun:test";\ntest("passes", () => expect(1).toBe(1));\n');

  const refused = await checksTest(false, ["--parallel=2", "tests/suite.test.ts"]);
  expect(refused.exitCode).toBe(2);
  expect(refused.text).toContain("refuses test filters");
});
