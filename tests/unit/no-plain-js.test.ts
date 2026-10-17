import { expect, test } from "bun:test";
import { isExempt, report, violationsOf } from "../../src/quality/no-plain-js.ts";

const MESSAGE = "plain JavaScript source in a TypeScript repository; convert it to TypeScript";

test("a plain script anywhere in the sources is a violation, sorted by path", () => {
  expect(violationsOf(["tools/build.mjs", "src/legacy.js", "src/index.ts", "run.cjs", "notes.md"])).toEqual([
    { file: "src/legacy.js", line: undefined, message: MESSAGE },
    { file: "tools/build.mjs", line: undefined, message: MESSAGE },
  ]);
});

test("TypeScript sources and other extensions pass", () => {
  for (const file of ["src/index.ts", "src/view.tsx", "src/lib.mts", "src/lib.cts", "src/types.d.ts", "data.json", "map.js.map", "archive.tar.js.zip"]) {
    expect(isExempt(file)).toBe(false);
    expect(violationsOf([file])).toEqual([]);
  }
});

test("generated output, vendored trees, served assets and fixture data pass", () => {
  for (const file of [
    "dist/effect-channel/index.js",
    "node_modules/pkg/index.js",
    "repos/effect/packages/effect/src/index.js",
    "public/app.js",
    "tests/fixtures/legacy.js",
    "dependency-cruiser.config.js",
  ]) {
    expect(isExempt(file)).toBe(true);
    expect(violationsOf([file])).toEqual([]);
  }
});

test("the Stryker config names and the shipped preset pass wherever they sit", () => {
  for (const file of [
    "stryker.conf.mjs",
    "stryker.config.js",
    ".stryker.conf.cjs",
    "packages/app/stryker.conf.mjs",
    "stryker.preset.js",
  ]) {
    expect(isExempt(file)).toBe(true);
    expect(violationsOf([file])).toEqual([]);
  }
});

test("a nested generated config and a near miss of a Stryker name still fail", () => {
  expect(violationsOf(["src/view.jsx"])).toEqual([]);
  for (const file of ["packages/app/dependency-cruiser.config.js", "notstryker.conf.mjs", "my-stryker.conf.mjs"]) {
    expect(isExempt(file)).toBe(false);
    expect(violationsOf([file])).toEqual([{ file, line: undefined, message: MESSAGE }]);
  }
});

test("the report counts the tree on a pass and names every violation on a failure", () => {
  expect(report({ files: 118, violations: [] })).toBe("no-plain-js: no plain JavaScript sources among 118 tracked file(s)");
  const lines = ["no-plain-js: 2 violation(s)", "  a.mjs: " + MESSAGE, "  b.js: " + MESSAGE];
  expect(report({ files: 3, violations: violationsOf(["b.js", "a.mjs"]) })).toBe(lines.join("\n"));
});
