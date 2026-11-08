import { expect, test } from "bun:test";
import { Effect, Schema } from "effect";
import { declarationFor, findGaps, parseWorkflow } from "../../../src/delivery/ci-wiring.ts";
import { ciWorkflow } from "../../../src/delivery/setup-workflow.ts";

const Step = Schema.Struct({ id: Schema.optional(Schema.String), if: Schema.optional(Schema.String), run: Schema.optional(Schema.String) });
const Generated = Schema.Struct({ jobs: Schema.Struct({ checks: Schema.Struct({ steps: Schema.Array(Step) }) }) });

const variants = [false, true].flatMap((isPrivate) => [false, true].map((hasBuild) => ciWorkflow(isPrivate, hasBuild)));

function stepRunning(text: string, command: string): typeof Step.Type {
  const { steps } = Schema.decodeUnknownSync(Generated)(Bun.YAML.parse(text)).jobs.checks;
  const step = steps.find(({ run }) => run === command);
  if (step === undefined) throw new Error(`no step runs ${command}`);
  return step;
}

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
