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

export const ENTRY_POINT: Program = { bin: "checks-lint", script: "core/lint.ts" };

export const TEST_ENTRY_POINT: Program = { bin: "checks-test", script: "testing/test.ts" };

export const DEFAULT_BRANCH = "main";

const TYPESCRIPT_SOURCE: TrackedContent = { pathspecs: ["*.ts", "*.tsx"], content: "TypeScript source" };

export const KIT_GATES = [
  { bin: "checks-lint-coverage", script: "quality/lint-coverage.sh", reads: "tree", appliesTo: TYPESCRIPT_SOURCE },
  { bin: "checks-test-layout", script: "testing/test-layout.ts", reads: "tree", appliesTo: TYPESCRIPT_SOURCE },
  { bin: "checks-commit-identity", script: "delivery/commit-identity.ts", reads: "range", appliesTo: EVERY_REPOSITORY },
  { bin: "checks-comment-gate", script: "quality/comment-gate.ts", reads: "range", appliesTo: EVERY_REPOSITORY },
  { bin: "checks-suppressions-ratchet", script: "complexity/suppressions-ratchet.ts", reads: "range", appliesTo: EVERY_REPOSITORY },
  { bin: "checks-ci-wiring", script: "delivery/ci-wiring.ts", reads: "tree", appliesTo: EVERY_REPOSITORY },
  { bin: "checks-docs", script: "docs/docs.ts", reads: "range", appliesTo: EVERY_REPOSITORY },
  { bin: "checks-repetition", script: "complexity/repetition.ts", reads: "range", appliesTo: TYPESCRIPT_SOURCE },
  { bin: "checks-quarantine-clock", script: "testing/quarantine-clock.ts", reads: "range", appliesTo: EVERY_REPOSITORY },
] as const satisfies readonly KitGate[];
