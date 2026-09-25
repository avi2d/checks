import { expect, test } from "bun:test";
import { Effect } from "effect";
import {
  bunfigViolations,
  isolationViolations,
  placementViolations,
  scriptViolations,
  type Violation,
} from "../scripts/test-layout.ts";

function isolation(file: string, source: string): Promise<readonly Violation[]> {
  return Effect.runPromise(isolationViolations(file, source));
}

const PRESET = { test: { pathIgnorePatterns: ["**/tests/quarantine/**", "repos/**"] } };

test("placement names every test file outside tests/**/*.test.ts and its target", () => {
  const violations = placementViolations([
    "src/widget.ts",
    "src/widget.test.ts",
    "src/deep/widget.spec.ts",
    "src/__tests__/widget_test.ts",
    "test/widget.test.ts",
    "widget.test.ts",
    "tests/widget.spec.ts",
    "tests/group/nested/widget.test.ts",
    "tests/e2e/widget.test.ts",
    "tests/lib/helper.ts",
    "tests/fixtures/sample.json",
  ]);

  expect(violations.map((violation) => [violation.file, violation.message.split("move it to ")[1]])).toEqual([
    ["src/widget.test.ts", "tests/widget.test.ts"],
    ["src/deep/widget.spec.ts", "tests/deep/widget.test.ts"],
    ["src/__tests__/widget_test.ts", "tests/widget.test.ts"],
    ["test/widget.test.ts", "tests/test/widget.test.ts"],
    ["widget.test.ts", "tests/widget.test.ts"],
    ["tests/widget.spec.ts", "tests/widget.test.ts"],
  ]);
});

test("tests/lib and tests/fixtures may hold helpers and data but never a test", () => {
  const violations = placementViolations(["tests/lib/helper.test.ts", "tests/fixtures/thing.test.ts"]);

  expect(violations).toEqual([
    {
      file: "tests/lib/helper.test.ts",
      line: undefined,
      message: "tests/lib and tests/fixtures hold helpers and data, never tests; move it to tests/helper.test.ts",
    },
    {
      file: "tests/fixtures/thing.test.ts",
      line: undefined,
      message: "tests/lib and tests/fixtures hold helpers and data, never tests; move it to tests/thing.test.ts",
    },
  ]);
});

test.each([
  ['import cp from "node:child_process";\n', "imports node:child_process"],
  ['import { execFileSync } from "child_process";\n', "imports node:child_process"],
  ['import { spawn } from "bun";\n', "imports spawn from bun"],
  ['import { spawnSync as s } from "bun";\n', "imports spawnSync from bun"],
  ['import { $ } from "bun";\n', "imports $ from bun"],
  ['export { $ } from "bun";\n', "imports $ from bun"],
  ['import { createServer } from "node:http";\n', "imports node:http"],
  ['import { connect } from "node:net";\n', "imports node:net"],
  ["const out = Bun.$`ls`;\n", "uses Bun.$"],
  ["const child = Bun.spawnSync([`ls`]);\n", "uses Bun.spawnSync"],
  ["const server = Bun.serve({ port: 0 });\n", "uses Bun.serve"],
  ['const body = await fetch("http://localhost");\n', "calls fetch"],
  ['const net = await import("node:net");\n', "imports node:net"],
  ['const http = require("node:http");\n', "requires node:http"],
])("an in-process test may not %j", async (source, expected) => {
  const violations = await isolation("tests/widget.test.ts", source);

  expect(violations).not.toBeEmpty();
  expect(violations[0]?.message).toStartWith(
    `a test outside tests/e2e/ must stay in-process, and this ${expected}`,
  );
  expect(violations[0]?.message).toEndWith("move it to tests/e2e/widget.test.ts");
});

test("an in-process test may read files, use fs and time, and import its own source", async () => {
  const source = [
    'import { readFile } from "node:fs/promises";',
    'import { join } from "node:path";',
    'import { widget } from "../src/widget.ts";',
    'const text = await readFile(join("a", "b"), "utf8");',
    "const value = widget(text, Date.now());",
    "",
  ].join("\n");

  expect(await isolation("tests/widget.test.ts", source)).toBeEmpty();
});

test("isolation reports the line the banned use sits on", async () => {
  const source = ["const a = 1;", "", "const b = Bun.spawn([`ls`]);", ""].join("\n");

  expect((await isolation("tests/widget.test.ts", source))[0]?.line).toBe(3);
});

test("isolation counts the line from the top of the file when leading trivia precedes the banned use", async () => {
  const source = ["// one", "// two", "", "", 'import cp from "node:child_process";', ""].join("\n");

  expect((await isolation("tests/widget.test.ts", source))[0]?.line).toBe(5);
});

test("isolation reports the right line when a multibyte character precedes the banned use", async () => {
  const source = ['const name = "🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀";', 'const b = 1, c = fetch("x");', "", "", "", ""].join("\n");

  expect((await isolation("tests/widget.test.ts", source))[0]?.line).toBe(2);
});

test("scripts.test must be the test entry point and scripts.lint must run the check", () => {
  expect(
    scriptViolations({
      scripts: {
        test: "checks-test",
        lint: "oxlint && bun ./node_modules/@avi2dg/checks/scripts/test-layout.ts",
      },
    }),
  ).toBeEmpty();

  expect(
    scriptViolations({
      scripts: {
        test: "bun scripts/test.ts",
        lint: "oxlint --type-aware && checks-lint-coverage && checks-test-layout",
      },
    }),
  ).toBeEmpty();

  for (const lint of ["oxlint --type-aware && checks-lint && depcruise src", "oxlint && bun scripts/lint.ts"]) {
    expect(scriptViolations({ scripts: { test: "checks-test", lint } })).toBeEmpty();
  }
  for (const lint of [
    "oxlint && checks-lint-coverage",
    "bun ./node_modules/@avi2dg/checks/scripts/lint.ts",
    "bun .checks/scripts/lint.ts",
  ]) {
    expect(scriptViolations({ scripts: { test: "checks-test", lint } })).toHaveLength(1);
  }
  for (const testScript of ["bun test --randomize", "checks-test && echo", "bunx checks-test"]) {
    expect(scriptViolations({ scripts: { test: testScript, lint: "checks-lint" } })).toHaveLength(1);
  }

  const violations = scriptViolations({ scripts: { test: "bun test", lint: "oxlint" } });
  expect(violations).toHaveLength(2);
  expect(violations[0]?.message).toContain('must be exactly "checks-test", which runs bun test --randomize and judges its skips');
  expect(violations[1]?.message).toContain("must run the layout check");
});

test("the consumer bunfig must carry every [test] key of the shipped preset", () => {
  expect(bunfigViolations(PRESET, PRESET, true)).toBeEmpty();
  expect(bunfigViolations({ test: { ...PRESET.test }, install: { exact: true } }, PRESET, true)).toBeEmpty();

  expect(bunfigViolations(undefined, PRESET, true)[0]?.message).toContain("bunfig.toml is missing");

  const drifted = bunfigViolations({ test: { randomize: false, pathIgnorePatterns: [] } }, PRESET, true);
  expect(drifted.map((violation) => violation.message.split(" must be ")[0])).toEqual(["[test].pathIgnorePatterns"]);
  expect(drifted[0]?.message).toContain("the check pins it");
});

test("repos/** is pinned only where quality.json declares libraries", () => {
  const unvendored = { test: { pathIgnorePatterns: ["**/tests/quarantine/**"] } };
  expect(bunfigViolations(unvendored, PRESET, false)).toBeEmpty();
  expect(bunfigViolations(unvendored, PRESET, true)[0]?.message).toContain('must be ["**/tests/quarantine/**","repos/**"]');
  expect(bunfigViolations(PRESET, PRESET, false)[0]?.message).toContain('must be ["**/tests/quarantine/**"]');
  expect(bunfigViolations(undefined, PRESET, false)[0]?.message).toContain('with [test].pathIgnorePatterns set to ["**/tests/quarantine/**"]');
});

test("the kit fails its own check when consumer and preset read the same drifted file", () => {
  const drifted = { test: { pathIgnorePatterns: [] as readonly string[] } };
  const violations = bunfigViolations(drifted, drifted, true);
  expect(violations.map((violation) => violation.message.split(" must be ")[0])).toEqual([
    "[test].pathIgnorePatterns",
  ]);
  expect(violations[0]?.message).toContain('["**/tests/quarantine/**","repos/**"]');
});
