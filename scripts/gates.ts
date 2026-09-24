import { Schema } from "effect";

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

export const QUALITY_FILE = "quality.json";

const TYPESCRIPT_SOURCE: TrackedContent = { pathspecs: ["*.ts", "*.tsx"], content: "TypeScript source" };

const QUALITY_DECLARATION: TrackedContent = { pathspecs: [QUALITY_FILE], content: `a ${QUALITY_FILE}` };

export const KIT_GATES = [
  { bin: "checks-lint-coverage", script: "lint-coverage.sh", reads: "tree", appliesTo: TYPESCRIPT_SOURCE },
  { bin: "checks-test-layout", script: "test-layout.ts", reads: "tree", appliesTo: TYPESCRIPT_SOURCE },
  { bin: "checks-commit-identity", script: "commit-identity.ts", reads: "range", appliesTo: EVERY_REPOSITORY },
  { bin: "checks-comment-gate", script: "comment-gate.ts", reads: "range", appliesTo: EVERY_REPOSITORY },
  { bin: "checks-suppressions-ratchet", script: "suppressions-ratchet.ts", reads: "range", appliesTo: EVERY_REPOSITORY },
  { bin: "checks-ci-wiring", script: "ci-wiring.ts", reads: "tree", appliesTo: EVERY_REPOSITORY },
  { bin: "checks-docs", script: "docs.ts", reads: "range", appliesTo: EVERY_REPOSITORY },
  { bin: "checks-quality", script: "quality.ts", reads: "tree", args: ["--check"], appliesTo: QUALITY_DECLARATION },
  { bin: "checks-size-budget", script: "size-budget.ts", reads: "range", appliesTo: TYPESCRIPT_SOURCE },
  { bin: "checks-feature-owners", script: "feature-owners.ts", reads: "range", appliesTo: TYPESCRIPT_SOURCE },
] as const satisfies readonly KitGate[];

const UNCONDITIONAL = KIT_GATES.filter((gate) => gate.appliesTo === EVERY_REPOSITORY).map((gate) => gate.bin);

// A selection without ci-wiring would go unchecked under checks-lint, so a gate every repository runs
// is refused where checks-lint decodes the selection, not by ci-wiring.
export const LintGates = Schema.Array(Schema.Literals(KIT_GATES.map((gate) => gate.bin))).check(
  Schema.makeFilter(
    (selected) => {
      const missing = UNCONDITIONAL.filter((bin) => !selected.includes(bin));
      if (missing.length === 0) return true;
      const verb = missing.length === 1 ? "applies" : "apply";
      return `checks-lint must run ${missing.join(", ")}, which ${verb} to ${EVERY_REPOSITORY}`;
    },
    { toJsonSchema: () => ({ allOf: UNCONDITIONAL.map((bin) => ({ contains: { const: bin } })) }) },
  ),
);

export function selectedGates(lintGates: typeof LintGates.Type | undefined): readonly KitGate[] {
  return lintGates === undefined ? KIT_GATES : KIT_GATES.filter((gate) => lintGates.includes(gate.bin));
}
