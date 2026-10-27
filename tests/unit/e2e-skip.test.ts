import { expect, test } from "bun:test";
import { skipsE2e } from "../../scripts/e2e-skip.ts";

test("a docs-only change skips the e2e tier", () => {
  expect(skipsE2e(["README.md", "docs/gates/checks-docs.md", "copy.json"])).toBe(true);
});

test("a Markdown file under tests/ or dist/ does not hold the e2e tier", () => {
  expect(skipsE2e(["tests/fixtures/docs/readme.md", "dist/templates/reference.md"])).toBe(true);
});

test("a copy.json below the root runs the e2e tier", () => {
  expect(skipsE2e(["src/copy.json", "tests/fixtures/copy.json"])).toBe(false);
});

test("one source file among Markdown files runs the e2e tier", () => {
  expect(skipsE2e(["README.md", "src/index.ts", "docs/guide.md"])).toBe(false);
});

test("a package or workflow change runs the e2e tier", () => {
  expect(skipsE2e(["package.json"])).toBe(false);
  expect(skipsE2e([".github/workflows/ci.yml"])).toBe(false);
});

test("a name that only ends like Markdown runs the e2e tier", () => {
  expect(skipsE2e(["README.mdx", "notes.md.txt"])).toBe(false);
});

test("a change that touches no file runs the e2e tier", () => {
  expect(skipsE2e([])).toBe(false);
});
