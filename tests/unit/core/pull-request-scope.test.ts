import { expect, test } from "bun:test";
import { isDocsPath, scopeOfChanges, scopeOfEvent } from "../../../src/core/pull-request-scope.ts";

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

test("a release pull request runs whole even when it changes only docs, not the narrowed set", () => {
  expect(scopeOfChanges("chore: release 1.4.0", ["CHANGELOG.md", "package.json"])).toEqual({ kind: "whole", because: "the pull request is a release" });
  expect(scopeOfChanges("chore: release 1.4.0", ["README.md"]).kind).toBe("whole");
});

test("a pull request that changes only top-level and docs/ Markdown is docs-only, while one more file keeps it narrowed", () => {
  expect(scopeOfChanges("docs: fix a link", ["README.md", "docs/gates/checks-test.md"])).toEqual({
    kind: "docs-only",
    changed: ["README.md", "docs/gates/checks-test.md"],
  });
  expect(scopeOfChanges("fix: a typo", ["README.md", "src/index.ts"])).toEqual({ kind: "pull-request", changed: ["README.md", "src/index.ts"] });
});

test("a pull request that changes no file is not docs-only, so it never runs nothing by default", () => {
  expect(scopeOfChanges("chore: empty", [])).toEqual({ kind: "pull-request", changed: [] });
});

test("a dispatched run and a run with no event run whole, and only pull_request reads the changes", () => {
  expect(scopeOfEvent("workflow_dispatch")).toEqual({ kind: "whole", because: "the run is workflow_dispatch, not a pull request" });
  expect(scopeOfEvent("")).toEqual({ kind: "whole", because: "the run is no pull request" });
  expect(scopeOfEvent("pull_request")).toBeUndefined();
});
