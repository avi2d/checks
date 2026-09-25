import { Schema } from "effect";

const Step = Schema.Struct({
  uses: Schema.optionalKey(Schema.String),
  run: Schema.optionalKey(Schema.String),
  with: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)),
});

const Workflow = Schema.Struct({
  on: Schema.Struct({
    push: Schema.optionalKey(Schema.Struct({ branches: Schema.Array(Schema.String) })),
    pull_request: Schema.Struct({ types: Schema.Array(Schema.String) }),
  }),
  jobs: Schema.Record(Schema.String, Schema.Struct({ steps: Schema.Array(Step) })),
});

export type ParsedWorkflow = typeof Workflow.Type;

export function parseWorkflow(text: string): ParsedWorkflow {
  return Schema.decodeUnknownSync(Workflow)(Bun.YAML.parse(text));
}

export function runs(workflow: ParsedWorkflow): readonly string[] {
  return Object.values(workflow.jobs).flatMap((job) => job.steps.flatMap((step) => (step.run === undefined ? [] : [step.run])));
}

export function setupBun(workflow: ParsedWorkflow): Readonly<Record<string, unknown>> | undefined {
  const steps = Object.values(workflow.jobs).flatMap((job) => job.steps);
  return steps.find((step) => step.uses?.startsWith("oven-sh/setup-bun@") === true)?.with;
}
