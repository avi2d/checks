import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { Effect, Schema } from "effect";
import { declarationFor, findGaps, parseWorkflow } from "../../../src/delivery/ci-wiring.ts";
import { ciWorkflow, MUTATION_WORKFLOW } from "../../../src/delivery/setup-workflow.ts";

const Step = Schema.Struct({ id: Schema.optional(Schema.String), if: Schema.optional(Schema.String), run: Schema.optional(Schema.String) });
const Generated = Schema.Struct({ jobs: Schema.Struct({ checks: Schema.Struct({ steps: Schema.Array(Step) }) }) });

const variants = [false, true].flatMap((isPrivate) => [false, true].map((hasBuild) => ciWorkflow(isPrivate, hasBuild)));

function stepRunning(text: string, command: string): typeof Step.Type {
  const { steps } = Schema.decodeUnknownSync(Generated)(Bun.YAML.parse(text)).jobs.checks;
  const step = steps.find(({ run }) => run === command);
  if (step === undefined) throw new Error(`no step runs ${command}`);
  return step;
}

const PullRequestFilter = Schema.Struct({
  on: Schema.Struct({ pull_request: Schema.Struct({ "paths-ignore": Schema.optional(Schema.Array(Schema.String)) }) }),
});

const mutationCallers = [
  { caller: "the caller checks-setup writes", text: MUTATION_WORKFLOW },
  { caller: "the kit's own caller", text: readFileSync(new URL("../../../.github/workflows/mutation.yml", import.meta.url), "utf8") },
];

const RELEASE_COMMIT_FILES = ["CHANGELOG.md", "package.json"];

function startsOnPullRequest(text: string, changed: readonly string[]): boolean {
  const ignored = Schema.decodeUnknownSync(PullRequestFilter)(Bun.YAML.parse(text)).on.pull_request["paths-ignore"] ?? [];
  return changed.some((path) => !ignored.some((pattern) => new Bun.Glob(pattern).match(path)));
}

test.each(mutationCallers)("$caller starts no mutation run on a pull request that changes only what a release commits, instead of a run GitHub holds for approval and fails at the merge", ({ text }) => {
  expect(startsOnPullRequest(text, RELEASE_COMMIT_FILES)).toBe(false);
});

test.each(mutationCallers)("$caller still starts a mutation run on a pull request that changes a source, a test or the lockfile beside a release file, instead of skipping its comparison", ({ text }) => {
  for (const beside of ["src/core/lint.ts", "tests/unit/core/lint.test.ts", "tests/lib/env.ts", "bun.lock", "bunfig.toml", "stryker.conf.mjs"]) {
    expect(startsOnPullRequest(text, [...RELEASE_COMMIT_FILES, beside])).toBe(true);
  }
});

test("typecheck and test still run after a failed lint step instead of being skipped by the implicit success()", () => {
  for (const text of variants) {
    const { id: install } = stepRunning(text, "bun install --frozen-lockfile");
    for (const command of ["bun run typecheck", "bun run test"]) {
      const condition = stepRunning(text, command).if ?? "";
      expect(condition).toContain("!cancelled()");
      expect(condition).toContain(`steps.${install}.outcome == 'success'`);
    }
  }
});

test("the conditioned typecheck and test steps still satisfy ci-wiring rather than counting as disabled", () => {
  for (const [hasBuild, scripts] of [[false, ["lint", "typecheck", "test"]], [true, ["lint", "build", "typecheck", "test"]]] as const) {
    const parsed = Effect.runSync(parseWorkflow(".github/workflows/ci.yml", ciWorkflow(false, hasBuild)));
    expect(findGaps(declarationFor(scripts, "main"), [parsed])).toEqual([]);
  }
});
