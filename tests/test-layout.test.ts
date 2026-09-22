import { expect, test } from "bun:test";
import {
  bunfigViolations,
  isolationViolations,
  placementViolations,
  scriptViolations,
} from "../scripts/test-layout.ts";

const PRESET = { test: { randomize: true, coverage: false, pathIgnorePatterns: ["**/tests/quarantine/**"] } };

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
])("an in-process test may not %j", (source, expected) => {
  const violations = isolationViolations("tests/widget.test.ts", source);

  expect(violations).not.toBeEmpty();
  expect(violations[0]?.message).toStartWith(
    `a test outside tests/e2e/ must stay in-process, and this ${expected}`,
  );
  expect(violations[0]?.message).toEndWith("move it to tests/e2e/widget.test.ts");
});

test("an in-process test may read files, use fs and time, and import its own source", () => {
  const source = [
    'import { readFile } from "node:fs/promises";',
    'import { join } from "node:path";',
    'import { widget } from "../src/widget.ts";',
    'const text = await readFile(join("a", "b"), "utf8");',
    "const value = widget(text, Date.now());",
    "",
  ].join("\n");

  expect(isolationViolations("tests/widget.test.ts", source)).toBeEmpty();
});

test("isolation reports the line the banned use sits on", () => {
  const source = ["const a = 1;", "", "const b = Bun.spawn([`ls`]);", ""].join("\n");

  expect(isolationViolations("tests/widget.test.ts", source)[0]?.line).toBe(3);
});

test("scripts.test must be the exact randomized command and scripts.lint must run the check", () => {
  expect(
    scriptViolations({
      scripts: {
        test: "bun test --randomize",
        lint: "oxlint && bun ./node_modules/@avi2d/checks/scripts/test-layout.ts",
      },
    }),
  ).toBeEmpty();

  const violations = scriptViolations({ scripts: { test: "bun test", lint: "oxlint" } });
  expect(violations).toHaveLength(2);
  expect(violations[0]?.message).toContain('must be exactly "bun test --randomize"');
  expect(violations[1]?.message).toContain("must run the layout check");
});

test("the consumer bunfig must carry every [test] key of the shipped preset", () => {
  expect(bunfigViolations(PRESET, PRESET)).toBeEmpty();
  expect(bunfigViolations({ test: { ...PRESET.test }, install: { exact: true } }, PRESET)).toBeEmpty();

  expect(bunfigViolations(undefined, PRESET)[0]?.message).toContain("bunfig.toml is missing");

  const drifted = bunfigViolations({ test: { randomize: false, coverage: false } }, PRESET);
  expect(drifted.map((violation) => violation.message.split(" must be ")[0])).toEqual([
    "[test].randomize",
    "[test].pathIgnorePatterns",
  ]);
  expect(drifted[0]?.message).toContain("bun has no bunfig extends");
});
