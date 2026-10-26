import { expect, test } from "bun:test";
import { passes, report, type Scan } from "../../src/quality/frontend-syntax.ts";

const CLEAN: Scan = {
  inputs: [
    { glob: "src/**/*.css", files: ["src/a.css", "src/b.css"] },
    { glob: "src/**/*.{css,astro}", files: ["src/a.css", "src/Base.astro"] },
  ],
  violations: [],
};

test("a clean scan passes and counts each file once across overlapping inputs", () => {
  expect(passes(CLEAN)).toBe(true);
  expect(report(CLEAN)).toBe("frontend-syntax: no violation in 3 file(s) from 2 declared input(s)");
});

test("an input that matches no file fails beside each violation, which names its file, line and column", () => {
  const scan: Scan = {
    inputs: [...CLEAN.inputs, { glob: "dist/**/*.html", files: [] }],
    violations: [{ file: "src/a.css", line: 3, column: 17, text: 'Disallowed value "all 1s" for property "transition".' }],
  };
  expect(passes(scan)).toBe(false);
  expect(report(scan)).toBe(
    [
      "frontend-syntax: 2 problem(s) in 3 file(s) from 3 declared input(s):",
      "  dist/**/*.html: the declared input matches no file",
      '  src/a.css:3:17 Disallowed value "all 1s" for property "transition".',
    ].join("\n"),
  );
  expect(passes({ inputs: [{ glob: "dist/**/*.html", files: [] }], violations: [] })).toBe(false);
});
