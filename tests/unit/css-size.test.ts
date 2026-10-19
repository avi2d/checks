import { expect, test } from "bun:test";
import { lineCount, report, violationsOf } from "../../src/quality/css-size.ts";

test("the count holds every line, blank lines and comments included", () => {
  expect(lineCount("")).toBe(0);
  expect(lineCount("a { top: 0; }\n")).toBe(1);
  expect(lineCount("a { top: 0; }\n\n/* a comment */\nb { top: 0; }\n")).toBe(4);
  expect(lineCount("a { top: 0; }\nb { top: 0; }")).toBe(2);
});

test("a stylesheet over 400 lines is a violation, sorted by path", () => {
  const over = { file: "src/site.css", lines: 1901 };
  const alsoOver = { file: "src/extra.css", lines: 401 };
  expect(violationsOf([over, alsoOver, { file: "src/small.css", lines: 400 }, { file: "src/empty.css", lines: 0 }])).toEqual([
    { file: "src/extra.css", line: undefined, message: "401 lines, over the 400-line budget; split the stylesheet into smaller files" },
    { file: "src/site.css", line: undefined, message: "1901 lines, over the 400-line budget; split the stylesheet into smaller files" },
  ]);
});

test("the report counts the stylesheets on a pass and names every overlong one on a failure", () => {
  expect(report({ files: 3, violations: [] })).toBe("css-size: no stylesheet over 400 lines among 3 CSS file(s)");
  expect(report({ files: 0, violations: [] })).toBe("css-size: no stylesheet over 400 lines among 0 CSS file(s)");
  const violations = violationsOf([{ file: "src/site.css", lines: 1901 }]);
  expect(report({ files: 1, violations })).toBe(
    "css-size: 1 violation(s)\n  src/site.css: 1901 lines, over the 400-line budget; split the stylesheet into smaller files",
  );
});
