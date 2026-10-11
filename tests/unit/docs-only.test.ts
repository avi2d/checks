import { expect, test } from "bun:test";
import { isDocsPath } from "../../src/delivery/docs-only.ts";

test("only top-level and docs/ Markdown counts as docs-only", () => {
  for (const path of ["README.md", "readme.MD", "CONTRIBUTING.md", "docs/gates/checks-docs.md", "docs/adr/0001-x.md"]) {
    expect(isDocsPath(path)).toBe(true);
  }
  for (const path of [
    "tests/fixtures/docs/readme.md",
    "dist/templates/reference.md",
    "src/delivery/notes.md",
    "docs/image.png",
    "src/index.ts",
    "package.json",
    ".github/workflows/ci.yml",
    "docs",
    "README.mdown",
    "src/docs.ts",
  ]) {
    expect(isDocsPath(path)).toBe(false);
  }
});
