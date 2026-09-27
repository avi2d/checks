export type Program = {
  readonly bin: string;
  readonly script: string;
};

type TrackedContent = {
  readonly pathspecs: readonly string[];
  readonly content: string;
};

export const EVERY_REPOSITORY = "every repository";

export const VECTORS = ["complexity", "quality", "tests", "docs", "delivery", "dependencies"] as const;

export type Vector = (typeof VECTORS)[number];

const VECTOR_DIRECTORIES = {
  complexity: "complexity",
  quality: "quality",
  tests: "testing",
  docs: "docs",
  delivery: "delivery",
  dependencies: "dependencies",
} as const satisfies Record<Vector, string>;

export type KitGate = Program & {
  readonly vector: Vector;
  readonly reads: "tree" | "range";
  readonly args?: readonly string[];
  readonly appliesTo: typeof EVERY_REPOSITORY | TrackedContent;
};

export const ENTRY_POINT: Program = { bin: "checks-lint", script: "core/lint.ts" };

export const TEST_ENTRY_POINT: Program = { bin: "checks-test", script: "testing/test.ts" };

export const DEFAULT_BRANCH = "main";

const TYPESCRIPT_SOURCE: TrackedContent = { pathspecs: ["*.ts", "*.tsx"], content: "TypeScript source" };

function inVector(vector: Vector, file: string): Pick<KitGate, "vector" | "script"> {
  return { vector, script: `${VECTOR_DIRECTORIES[vector]}/${file}` };
}

export const KIT_GATES = [
  { bin: "checks-suppressions-ratchet", ...inVector("complexity", "suppressions-ratchet.ts"), reads: "range", appliesTo: EVERY_REPOSITORY },
  { bin: "checks-repetition", ...inVector("complexity", "repetition.ts"), reads: "range", appliesTo: TYPESCRIPT_SOURCE },
  { bin: "checks-lint-coverage", ...inVector("quality", "lint-coverage.sh"), reads: "tree", appliesTo: TYPESCRIPT_SOURCE },
  { bin: "checks-comment-gate", ...inVector("quality", "comment-gate.ts"), reads: "range", appliesTo: EVERY_REPOSITORY },
  { bin: "checks-test-layout", ...inVector("tests", "test-layout.ts"), reads: "tree", appliesTo: TYPESCRIPT_SOURCE },
  { bin: "checks-quarantine-clock", ...inVector("tests", "quarantine-clock.ts"), reads: "range", appliesTo: EVERY_REPOSITORY },
  { bin: "checks-docs", ...inVector("docs", "docs.ts"), reads: "range", appliesTo: EVERY_REPOSITORY },
  { bin: "checks-commit-identity", ...inVector("delivery", "commit-identity.ts"), reads: "range", appliesTo: EVERY_REPOSITORY },
  { bin: "checks-ci-wiring", ...inVector("delivery", "ci-wiring.ts"), reads: "tree", appliesTo: EVERY_REPOSITORY },
] as const satisfies readonly KitGate[];
