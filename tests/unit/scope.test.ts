import { expect, test } from "bun:test";
import { classifyPath, FAST_TREE_GATES, selectScope } from "../../src/core/scope.ts";

const RANGE_GATES = [
  "checks-commit-identity",
  "checks-comment-gate",
  "checks-suppressions-ratchet",
  "checks-secrets",
  "checks-docs",
  "checks-repetition",
  "checks-exports",
  "checks-quarantine-clock",
  "checks-advisories",
];

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
  expect(scope).toEqual({ full: false, gates: RANGE_GATES, tests: "none" });
});

test("a docs-only change runs the unit tier", () => {
  expect(selectScope(["docs/design.md"]).tests).toBe("none");
});

test("a copy change skips checks-copy", () => {
  const scope = selectScope(["copy.json"]);
  expect(scope.full).toBe(false);
  expect(scope.gates).toContain("checks-copy");
  expect(scope.gates.filter((bin) => TREE_GATES.includes(bin))).toEqual(["checks-copy"]);
  expect(scope.tests).toBe("none");
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
  expect(selectScope(["src/core/lint.ts"])).toEqual({ full: false, gates: FULL_GATES, tests: "unit-and-touched" });
});

test("a typescript change skips the touched e2e files", () => {
  expect(selectScope(["src/core/lint.ts"]).tests).toBe("unit-and-touched");
});

test("a test change skips test-layout", () => {
  const scope = selectScope(["tests/unit/lint.test.ts"]);
  expect(scope.gates).toContain("checks-test-layout");
  expect(scope.tests).toBe("unit-and-touched");
});

test("a test change runs the full e2e tier", () => {
  expect(selectScope(["tests/e2e/docs.test.ts"]).tests).toBe("unit-and-touched");
});

test("a quarantined test change skips the quarantine clock", () => {
  const scope = selectScope(["tests/quarantine/unit/flaky.test.ts"]);
  expect(scope.gates).toContain("checks-quarantine-clock");
  expect(scope.gates).toContain("checks-test-layout");
});

test("a workflow change runs the scoped matrix", () => {
  const scope = selectScope([".github/workflows/ci.yml"]);
  expect(scope.full).toBe(true);
  expect(scope.tests).toBe("full");
});

test("a lockfile change runs the scoped matrix", () => {
  const scope = selectScope(["bun.lock"]);
  expect(scope.full).toBe(true);
  expect(scope.tests).toBe("full");
});

test("a suppression change runs a tree gate", () => {
  const scope = selectScope(["oxlint-suppressions.json"]);
  expect(scope.full).toBe(false);
  expect(scope.gates).toContain("checks-suppressions-ratchet");
  expect(scope.gates.filter((bin) => TREE_GATES.includes(bin))).toEqual([]);
  expect(scope.tests).toBe("none");
});

test("a secret-adjacent change skips the secrets scan", () => {
  expect(selectScope(["gitleaks.toml"]).gates).toContain("checks-secrets");
  expect(selectScope(["config/credentials.json"]).gates).toContain("checks-secrets");
});

test("a secrets source file selects the typescript tree", () => {
  expect(classifyPath("src/delivery/secrets.ts")).toBe("typescript");
  expect(selectScope(["src/delivery/secrets.ts"]).tests).toBe("unit-and-touched");
});

test("an unknown path runs the scoped matrix", () => {
  expect(selectScope(["Dockerfile"]).full).toBe(true);
});

test("an empty range runs the scoped matrix", () => {
  expect(selectScope([])).toEqual({ full: true, gates: FULL_GATES, tests: "full" });
});

test("the desk run skips the two slowest tree gates", () => {
  expect(FAST_TREE_GATES).toEqual(TREE_GATES.filter((bin) => bin !== "checks-unused" && bin !== "checks-imports"));
});
