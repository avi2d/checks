export type Program = {
  readonly bin: string;
  readonly script: string;
};

export type KitGate = Program & {
  readonly reads: "tree" | "range";
};

export const ENTRY_POINT: Program = { bin: "checks-lint", script: "lint.ts" };

export const DEFAULT_BRANCH = "main";

export const KIT_GATES: readonly KitGate[] = [
  { bin: "checks-lint-coverage", script: "lint-coverage.sh", reads: "tree" },
  { bin: "checks-test-layout", script: "test-layout.ts", reads: "tree" },
  { bin: "checks-commit-identity", script: "commit-identity.ts", reads: "range" },
  { bin: "checks-comment-gate", script: "comment-gate.ts", reads: "range" },
  { bin: "checks-suppressions-ratchet", script: "suppressions-ratchet.ts", reads: "range" },
  { bin: "checks-ci-wiring", script: "ci-wiring.ts", reads: "tree" },
];
