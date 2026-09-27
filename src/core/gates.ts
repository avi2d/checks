export type Program = {
  readonly bin: string;
  readonly script: string;
};

type TrackedContent = {
  readonly pathspecs: readonly string[];
  readonly content: string;
};

export const EVERY_REPOSITORY = "every repository";

export const VECTORS = ["complexity", "quality", "testing", "docs", "delivery", "dependencies"] as const;

export type Vector = (typeof VECTORS)[number];

export type KitGate = {
  readonly bin: string;
  readonly vector: Vector;
  readonly file: string;
  readonly reads: "tree" | "range";
  readonly args?: readonly string[];
  readonly appliesTo: typeof EVERY_REPOSITORY | TrackedContent;
};

export const ENTRY_POINT: Program = { bin: "checks-lint", script: "core/lint.ts" };

export const TEST_ENTRY_POINT: Program = { bin: "checks-test", script: "testing/test.ts" };

export const DEFAULT_BRANCH = "main";

const TYPESCRIPT_SOURCE: TrackedContent = { pathspecs: ["*.ts", "*.tsx"], content: "TypeScript source" };

export const KIT_GATES = [
  { bin: "checks-lint-coverage", vector: "quality", file: "lint-coverage.sh", reads: "tree", appliesTo: TYPESCRIPT_SOURCE },
  { bin: "checks-test-layout", vector: "testing", file: "test-layout.ts", reads: "tree", appliesTo: TYPESCRIPT_SOURCE },
  { bin: "checks-commit-identity", vector: "delivery", file: "commit-identity.ts", reads: "range", appliesTo: EVERY_REPOSITORY },
  { bin: "checks-comment-gate", vector: "quality", file: "comment-gate.ts", reads: "range", appliesTo: EVERY_REPOSITORY },
  { bin: "checks-suppressions-ratchet", vector: "complexity", file: "suppressions-ratchet.ts", reads: "range", appliesTo: EVERY_REPOSITORY },
  { bin: "checks-ci-wiring", vector: "delivery", file: "ci-wiring.ts", reads: "tree", appliesTo: EVERY_REPOSITORY },
  { bin: "checks-docs", vector: "docs", file: "docs.ts", reads: "range", appliesTo: EVERY_REPOSITORY },
  { bin: "checks-repetition", vector: "complexity", file: "repetition.ts", reads: "range", appliesTo: TYPESCRIPT_SOURCE },
  { bin: "checks-quarantine-clock", vector: "testing", file: "quarantine-clock.ts", reads: "range", appliesTo: EVERY_REPOSITORY },
] as const satisfies readonly KitGate[];
