import { expect, test } from "bun:test";
import { classifyPath, FAST_TREE_GATES, selectScope } from "../../src/core/scope.ts";

const TREE_GATES = [
  "checks-lint-coverage",
  "checks-test-layout",
  "checks-effect-scope",
  "checks-frontend-syntax",
  "checks-css-size",
  "checks-no-plain-js",
  "checks-ci-wiring",
  "checks-copy",
  "checks-unused",
  "checks-imports",
];

test("a docs-only change runs a tree gate", () => {
  const scope = selectScope(["README.md", "docs/gates/checks-lint.md", "AGENTS.md"]);
  expect(scope.full).toBe(false);
  expect(scope.gates).toContain("checks-copy");
});

test("a copy change skips checks-copy", () => {
  const scope = selectScope(["copy.json"]);
  expect(scope.full).toBe(false);
  expect(scope.gates).toContain("checks-copy");
  expect(scope.gates.filter((bin) => TREE_GATES.includes(bin))).toEqual(["checks-copy"]);
});

const FULL_GATES = [
  "checks-lint-coverage",
  "checks-test-layout",
  "checks-commit-identity",
  "checks-comment-gate",
  "checks-effect-scope",
  "checks-frontend-syntax",
  "checks-css-size",
  "checks-no-plain-js",
  "checks-suppressions-ratchet",
  "checks-ci-wiring",
  "checks-secrets",
  "checks-docs",
  "checks-copy",
  "checks-repetition",
  "checks-unused",
  "checks-exports",
  "checks-quarantine-clock",
  "checks-imports",
  "checks-advisories",
];

test("a typescript change drops a tree gate", () => {
  expect(selectScope(["src/core/lint.ts"])).toEqual({ full: false, gates: FULL_GATES });
});

test("a test change skips test-layout", () => {
  const scope = selectScope(["tests/unit/lint.test.ts"]);
  expect(scope.gates).toContain("checks-test-layout");
});

test("a quarantined test change skips the quarantine clock", () => {
  const scope = selectScope(["tests/quarantine/unit/flaky.test.ts"]);
  expect(scope.gates).toContain("checks-quarantine-clock");
  expect(scope.gates).toContain("checks-test-layout");
});

test("a workflow change runs the scoped matrix", () => {
  const scope = selectScope([".github/workflows/ci.yml"]);
  expect(scope.full).toBe(true);
});

test("a lockfile change runs the scoped matrix", () => {
  const scope = selectScope(["bun.lock"]);
  expect(scope.full).toBe(true);
});

test("a suppression change runs a tree gate", () => {
  const scope = selectScope(["oxlint-suppressions.json"]);
  expect(scope.full).toBe(false);
  expect(scope.gates).toContain("checks-suppressions-ratchet");
  expect(scope.gates.filter((bin) => TREE_GATES.includes(bin))).toEqual([]);
});

test("a secret-like filename takes the full run instead of the range-only subset", () => {
  expect(classifyPath("gitleaks.toml")).toBe("unknown");
  expect(classifyPath("config/credentials.json")).toBe("unknown");
  expect(classifyPath("src/credentials.js")).toBe("unknown");
  expect(selectScope(["config/credentials.json"]).full).toBe(true);
  expect(selectScope(["src/credentials.js"]).full).toBe(true);
});

test("a secrets source file selects the typescript tree", () => {
  expect(classifyPath("src/delivery/secrets.ts")).toBe("typescript");
});

test("an unknown path runs the scoped matrix", () => {
  expect(selectScope(["Dockerfile"]).full).toBe(true);
});

test("an empty range runs the scoped matrix", () => {
  expect(selectScope([])).toEqual({ full: true, gates: FULL_GATES });
});

test("the desk run skips the two slowest tree gates", () => {
  expect(FAST_TREE_GATES).toEqual(TREE_GATES.filter((bin) => bin !== "checks-unused" && bin !== "checks-imports"));
});

test("a markdown content change keeps checks-copy instead of dropping it", () => {
  expect(selectScope(["content/home.md"]).gates).toContain("checks-copy");
});

test("a docs stylesheet takes the full run instead of the docs subset", () => {
  expect(classifyPath("docs/theme.css")).toBe("unknown");
  expect(selectScope(["docs/theme.css"]).full).toBe(true);
});

test("a config typescript file takes the full run instead of the typescript subset", () => {
  expect(classifyPath("oxlint.config.ts")).toBe("workflow");
  expect(selectScope(["oxlint.config.ts"]).full).toBe(true);
});
