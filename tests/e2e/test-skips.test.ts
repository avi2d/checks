import { $ } from "bun";
import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const SCRIPT = resolve(import.meta.dir, "..", "..", "scripts", "test.ts");

type Declaration = { readonly file: string; readonly test: string; readonly reason?: string; readonly when?: string };

let dir = "";

afterEach(async () => {
  if (dir !== "") {
    await rm(dir, { recursive: true, force: true });
    dir = "";
  }
});

async function consumer(suite: string, testSkips?: readonly Declaration[]): Promise<void> {
  dir = await mkdtemp(join(tmpdir(), "checks-test-skips-"));
  await mkdir(join(dir, "tests"));
  await writeFile(join(dir, "tests", "suite.test.ts"), `import { describe, expect, test } from "bun:test";\n${suite}`);
  await declare(testSkips);
}

async function declare(testSkips: readonly Declaration[] | undefined): Promise<void> {
  await writeFile(join(dir, "package.json"), JSON.stringify({ name: "consumer", scripts: { test: "checks-test" }, testSkips }));
}

async function checksTest(ci: boolean, args: readonly string[] = []): Promise<{ exitCode: number; text: string }> {
  const { CI: _ci, ...env } = process.env;
  const result = await $`bun ${SCRIPT} ${args}`
    .cwd(dir)
    .env(ci ? { ...env, CI: "true" } : env)
    .nothrow()
    .quiet();
  return { exitCode: result.exitCode, text: result.stdout.toString() + result.stderr.toString() };
}

const SKIPPED = `
test("runs", () => expect(1).toBe(1));
describe("pricing", () => {
  test.skip("rounds half to even", () => expect(1).toBe(1));
});
`;

test("an undeclared skip is refused, and its declaration lets the same run pass", async () => {
  await consumer(SKIPPED);
  const refused = await checksTest(false);
  expect(refused.exitCode).toBe(1);
  expect(refused.text).toContain("1 pass");
  expect(refused.text).toContain("checks-test: 1 skipped test(s) undeclared and 0 declaration(s) matching no skipped test in this local run:");
  expect(refused.text).toContain("  tests/suite.test.ts:5 pricing > rounds half to even: skipped with no declaration; run it, or declare it in package.json testSkips with its reason");

  await declare([{ file: "tests/suite.test.ts", test: "pricing > rounds half to even", reason: "waits on the rounding fix" }]);
  const declared = await checksTest(false);
  expect(declared.exitCode).toBe(0);
  expect(declared.text).toContain("checks-test: 1 skipped test(s), each declared in package.json testSkips");
});

test("a declaration that matches no skipped test is refused until it goes", async () => {
  await consumer(`test("rounds half to even", () => expect(1).toBe(1));\n`, [
    { file: "tests/suite.test.ts", test: "rounds half to even", reason: "waits on the rounding fix" },
  ]);
  const stale = await checksTest(false);
  expect(stale.exitCode).toBe(1);
  expect(stale.text).toContain("checks-test: 0 skipped test(s) undeclared and 1 declaration(s) matching no skipped test in this local run:");
  expect(stale.text).toContain("  tests/suite.test.ts > rounds half to even: declared, but no such test skipped; delete the declaration");

  await declare([]);
  const clean = await checksTest(false);
  expect(clean.exitCode).toBe(0);
  expect(clean.text).toContain("checks-test: no test skipped");
});

test("a skip only CI takes is declared for ci, and neither run holds the other's declaration against it", async () => {
  const onlyOnCi = `test.skipIf(Boolean(process.env.CI))("reaches the local daemon", () => expect(1).toBe(1));\n`;
  await consumer(onlyOnCi);
  const undeclared = await checksTest(true);
  expect(undeclared.exitCode).toBe(1);
  expect(undeclared.text).toContain("tests/suite.test.ts:2 reaches the local daemon: skipped with no declaration");
  expect((await checksTest(false)).exitCode).toBe(0);

  await declare([{ file: "tests/suite.test.ts", test: "reaches the local daemon", reason: "CI has no daemon" }]);
  const everywhere = await checksTest(false);
  expect(everywhere.exitCode).toBe(1);
  expect(everywhere.text).toContain("tests/suite.test.ts > reaches the local daemon: declared, but no such test skipped");

  await declare([{ file: "tests/suite.test.ts", test: "reaches the local daemon", reason: "CI has no daemon", when: "ci" }]);
  const ci = await checksTest(true);
  expect(ci.exitCode).toBe(0);
  expect(ci.text).toContain("checks-test: 1 skipped test(s), each declared in package.json testSkips");
  const local = await checksTest(false);
  expect(local.exitCode).toBe(0);
  expect(local.text).toContain("checks-test: no test skipped; 1 declaration(s) for ci not judged in this local run");
});

test("a todo is a test that never ran, so it needs a declaration too", async () => {
  await consumer(`test.todo("refunds a partial order");\n`);
  const todo = await checksTest(false);
  expect(todo.exitCode).toBe(1);
  expect(todo.text).toContain("tests/suite.test.ts:2 refunds a partial order: a todo with no declaration");
});

test("a failing test fails the run even when no skip needs a declaration", async () => {
  await consumer(`test("breaks", () => expect(1).toBe(2));\n`);
  const failed = await checksTest(false);
  expect(failed.exitCode).toBe(1);
  expect(failed.text).toContain("(fail) breaks");
  expect(failed.text).toContain("checks-test: no test skipped");
});

test("a narrowed run and a declaration without a reason are refused before any verdict", async () => {
  await consumer(SKIPPED);
  const narrowed = await checksTest(false, ["-t", "runs"]);
  expect(narrowed.exitCode).toBe(2);
  expect(narrowed.text).toContain("checks-test: usage: checks-test takes no arguments");

  await declare([{ file: "tests/suite.test.ts", test: "pricing > rounds half to even" }]);
  const reasonless = await checksTest(false);
  expect(reasonless.exitCode).toBe(2);
  expect(reasonless.text).toContain("checks-test: cannot read package.json testSkips");
  expect(reasonless.text).toContain("reason");
});
