import { expect, test } from "bun:test";
import { Effect } from "effect";
import {
  bunfigViolations,
  isolationViolations,
  placementViolations,
  scriptViolations,
  type Violation,
} from "../../src/testing/test-layout.ts";

function isolation(file: string, source: string): Promise<readonly Violation[]> {
  return Effect.runPromise(isolationViolations(file, source));
}

const PRESET = {
  test: { pathIgnorePatterns: ["**/tests/quarantine/**", "**/tests/live/**", "**/tests/pixel/**", "repos/**"] },
};

test("placement names every test file outside tests/<level>/**/*.test.ts and its target", () => {
  const violations = placementViolations([
    "src/widget.ts",
    "src/widget.test.ts",
    "src/deep/widget.spec.ts",
    "src/__tests__/widget_test.ts",
    "test/widget.test.ts",
    "widget.test.ts",
    "tests/widget.spec.ts",
    "tests/group/nested/widget.test.ts",
    "tests/integration/widget.test.ts",
    "tests/unit/widget.test.ts",
    "tests/unit/group/widget.test.ts",
    "tests/e2e/widget.test.ts",
    "tests/live/widget.test.ts",
    "tests/pixel/widget.test.ts",
    "tests/quarantine/unit/widget.test.ts",
    "tests/quarantine/e2e/group/widget.test.ts",
    "tests/lib/helper.ts",
    "tests/fixtures/sample.json",
  ]);

  expect(violations.map((violation) => [violation.file, violation.message.split("move it to ")[1]])).toEqual([
    ["src/widget.test.ts", "tests/unit/widget.test.ts"],
    ["src/deep/widget.spec.ts", "tests/unit/deep/widget.test.ts"],
    ["src/__tests__/widget_test.ts", "tests/unit/widget.test.ts"],
    ["test/widget.test.ts", "tests/unit/test/widget.test.ts"],
    ["widget.test.ts", "tests/unit/widget.test.ts"],
    ["tests/widget.spec.ts", "tests/unit/widget.test.ts"],
    ["tests/group/nested/widget.test.ts", "tests/unit/group/nested/widget.test.ts"],
    ["tests/integration/widget.test.ts", "tests/unit/integration/widget.test.ts"],
  ]);
  expect(violations[0]?.message).toBe(
    "a test file must live at tests/<level>/**/*.test.ts, or tests/quarantine/<level>/**/*.test.ts while quarantined, with unit, e2e, live, or pixel as the level; move it to tests/unit/widget.test.ts",
  );
});

test("a quarantined test keeps its level under tests/quarantine/, and a quarantine directory below a level is refused", () => {
  const violations = placementViolations([
    "tests/quarantine/widget.test.ts",
    "tests/quarantine/group/widget.spec.ts",
    "tests/e2e/quarantine/widget.test.ts",
    "tests/unit/group/quarantine/deep/widget.test.ts",
    "tests/quarantine/live/widget.test.ts",
  ]);

  expect(violations.map((violation) => [violation.file, violation.message.split("move it to ")[1]])).toEqual([
    ["tests/quarantine/widget.test.ts", "tests/quarantine/unit/widget.test.ts"],
    ["tests/quarantine/group/widget.spec.ts", "tests/quarantine/unit/group/widget.test.ts"],
    ["tests/e2e/quarantine/widget.test.ts", "tests/quarantine/e2e/widget.test.ts"],
    ["tests/unit/group/quarantine/deep/widget.test.ts", "tests/quarantine/unit/group/deep/widget.test.ts"],
  ]);
  expect(violations[0]?.message).toStartWith("a quarantined test keeps its level at tests/quarantine/<level>/, which the default run skips;");
});

test("tests/lib and tests/fixtures may hold helpers and data but never a test", () => {
  const violations = placementViolations(["tests/lib/helper.test.ts", "tests/fixtures/thing.test.ts"]);

  expect(violations).toEqual([
    {
      file: "tests/lib/helper.test.ts",
      line: undefined,
      message: "tests/lib and tests/fixtures hold helpers and data, never tests; move it to tests/unit/helper.test.ts",
    },
    {
      file: "tests/fixtures/thing.test.ts",
      line: undefined,
      message: "tests/lib and tests/fixtures hold helpers and data, never tests; move it to tests/unit/thing.test.ts",
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
  const violations = await isolation("tests/unit/widget.test.ts", source);

  expect(violations).not.toBeEmpty();
  expect(violations[0]?.message).toStartWith(
    `a test outside tests/e2e/ must stay in-process, and this ${expected}`,
  );
  expect(violations[0]?.message).toEndWith("move it to tests/e2e/widget.test.ts");
});

test("a quarantined in-process test that spawns is sent to the e2e level inside quarantine", async () => {
  const spawn = 'import { spawnSync } from "node:child_process";\n';

  expect((await isolation("tests/quarantine/unit/widget.test.ts", spawn))[0]?.message).toEndWith("move it to tests/quarantine/e2e/widget.test.ts");
  expect((await isolation("tests/quarantine/widget.test.ts", spawn))[0]?.message).toEndWith("move it to tests/quarantine/e2e/widget.test.ts");
});

test("an in-process test may read files, use fs and time, and import its own source", async () => {
  const source = [
    'import { readFile } from "node:fs/promises";',
    'import { join } from "node:path";',
    'import { widget } from "../../src/widget.ts";',
    'const text = await readFile(join("a", "b"), "utf8");',
    "const value = widget(text, Date.now());",
    "",
  ].join("\n");

  expect(await isolation("tests/unit/widget.test.ts", source)).toBeEmpty();
});

test("isolation reports the line the banned use sits on", async () => {
  const source = ["const a = 1;", "", "const b = Bun.spawn([`ls`]);", ""].join("\n");

  expect((await isolation("tests/unit/widget.test.ts", source))[0]?.line).toBe(3);
});

test("isolation counts the line from the top of the file when leading trivia precedes the banned use", async () => {
  const source = ["// one", "// two", "", "", 'import cp from "node:child_process";', ""].join("\n");

  expect((await isolation("tests/unit/widget.test.ts", source))[0]?.line).toBe(5);
});

test("isolation reports the right line when a multibyte character precedes the banned use", async () => {
  const source = ['const name = "🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀";', 'const b = 1, c = fetch("x");', "", "", "", ""].join("\n");

  expect((await isolation("tests/unit/widget.test.ts", source))[0]?.line).toBe(2);
});

test("scripts.test must be the test entry point and scripts.lint must run the check", () => {
  expect(
    scriptViolations({
      scripts: {
        test: "checks-test",
        lint: "oxlint && bun ./node_modules/@avi2dg/checks/src/testing/test-layout.ts",
      },
    }),
  ).toBeEmpty();

  expect(
    scriptViolations({
      scripts: {
        test: "bun src/testing/test.ts",
        lint: "oxlint --type-aware && checks-lint-coverage && checks-test-layout",
      },
    }),
  ).toBeEmpty();

  for (const lint of ["oxlint --type-aware && checks-lint && depcruise src", "oxlint && bun src/core/lint.ts"]) {
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

test("a live or pixel test tier requires its named checks-test script", () => {
  const scripts = { test: "checks-test", lint: "checks-lint" };
  for (const tier of ["live", "pixel"] as const) {
    const files = [`tests/${tier}/screen.test.ts`];
    const violation = scriptViolations({ scripts }, files).find((candidate) => candidate.message.includes(`test:${tier}`));
    expect(violation?.message ?? "").toContain(`test:${tier} must be "checks-test --tier=${tier}"`);
    expect(
      scriptViolations({ scripts: { ...scripts, [`test:${tier}`]: `checks-test --tier=${tier}` } }, files),
    ).toBeEmpty();
  }
});

test("the consumer bunfig must carry every [test] key of the shipped preset", () => {
  expect(bunfigViolations(PRESET, PRESET)).toBeEmpty();
  expect(bunfigViolations({ test: { ...PRESET.test }, install: { exact: true } }, PRESET)).toBeEmpty();

  expect(bunfigViolations(undefined, PRESET)[0]?.message).toContain("bunfig.toml is missing");

  const drifted = bunfigViolations({ test: { randomize: false, pathIgnorePatterns: [] } }, PRESET);
  expect(drifted.map((violation) => violation.message.split(" must be ")[0])).toEqual(["[test].pathIgnorePatterns"]);
  expect(drifted[0]?.message).toContain("the check pins it");
});

test("the preset's ignores and the base list alone both pass, and nothing else does", () => {
  const base = {
    test: { pathIgnorePatterns: ["**/tests/quarantine/**", "**/tests/live/**", "**/tests/pixel/**"] },
  };
  expect(bunfigViolations(PRESET, PRESET)).toBeEmpty();
  expect(bunfigViolations(base, PRESET)).toBeEmpty();
  const reposOnly = bunfigViolations({ test: { pathIgnorePatterns: ["repos/**"] } }, PRESET);
  expect(reposOnly.map((violation) => violation.message.split(", found ")[0])).toEqual([
    '[test].pathIgnorePatterns must be ["**/tests/quarantine/**","**/tests/live/**","**/tests/pixel/**","repos/**"] or ["**/tests/quarantine/**","**/tests/live/**","**/tests/pixel/**"]',
  ]);
});

test("the kit fails its own check when consumer and preset read the same drifted file", () => {
  const drifted = { test: { pathIgnorePatterns: [] as readonly string[] } };
  const violations = bunfigViolations(drifted, drifted);
  expect(violations.map((violation) => violation.message.split(" must be ")[0])).toEqual([
    "[test].pathIgnorePatterns",
  ]);
  expect(violations[0]?.message).toContain('["**/tests/quarantine/**","**/tests/live/**","**/tests/pixel/**","repos/**"]');
});
