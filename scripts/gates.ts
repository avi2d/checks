export type Program = {
  readonly bin: string;
  readonly script: string;
};

type TrackedContent = {
  readonly pathspecs: readonly string[];
  readonly content: string;
};

export const EVERY_REPOSITORY = "every repository";

export type KitGate = Program & {
  readonly reads: "tree" | "range";
  readonly args?: readonly string[];
  readonly appliesTo: typeof EVERY_REPOSITORY | TrackedContent;
};

export const ENTRY_POINT: Program = { bin: "checks-lint", script: "lint.ts" };

export const TEST_ENTRY_POINT: Program = { bin: "checks-test", script: "test.ts" };

export const DEFAULT_BRANCH = "main";

const TYPESCRIPT_SOURCE: TrackedContent = { pathspecs: ["*.ts", "*.tsx"], content: "TypeScript source" };

export const KIT_GATES = [
  { bin: "checks-lint-coverage", script: "lint-coverage.sh", reads: "tree", appliesTo: TYPESCRIPT_SOURCE },
  { bin: "checks-test-layout", script: "test-layout.ts", reads: "tree", appliesTo: TYPESCRIPT_SOURCE },
  { bin: "checks-commit-identity", script: "commit-identity.ts", reads: "range", appliesTo: EVERY_REPOSITORY },
  { bin: "checks-comment-gate", script: "comment-gate.ts", reads: "range", appliesTo: EVERY_REPOSITORY },
  { bin: "checks-suppressions-ratchet", script: "suppressions-ratchet.ts", reads: "range", appliesTo: EVERY_REPOSITORY },
  { bin: "checks-ci-wiring", script: "ci-wiring.ts", reads: "tree", appliesTo: EVERY_REPOSITORY },
  { bin: "checks-docs", script: "docs.ts", reads: "range", appliesTo: EVERY_REPOSITORY },
  { bin: "checks-size-budget", script: "size-budget.ts", reads: "range", appliesTo: TYPESCRIPT_SOURCE },
  { bin: "checks-repetition", script: "repetition.ts", reads: "range", appliesTo: TYPESCRIPT_SOURCE },
  { bin: "checks-quarantine-clock", script: "quarantine-clock.ts", reads: "range", appliesTo: EVERY_REPOSITORY },
] as const satisfies readonly KitGate[];
