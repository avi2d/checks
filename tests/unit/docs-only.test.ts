import { expect, test } from "bun:test";
import { isDocsPath } from "../../src/delivery/docs-only.ts";

test("only Markdown and docs paths count as docs-only", () => {
  for (const path of ["README.md", "CONTRIBUTING.md", "docs/gates/checks-docs.md", "docs/adr/0001-x.md", "docs/image.png"]) {
    expect(isDocsPath(path)).toBe(true);
  }
  for (const path of ["src/index.ts", "package.json", ".github/workflows/ci.yml", "docs", "README.mdown", "src/docs.ts"]) {
    expect(isDocsPath(path)).toBe(false);
  }
});
