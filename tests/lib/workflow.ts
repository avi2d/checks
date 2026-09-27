import { Schema } from "effect";

const Step = Schema.Struct({
  uses: Schema.optionalKey(Schema.String),
  run: Schema.optionalKey(Schema.String),
  with: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)),
  env: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
});

const Workflow = Schema.Struct({
  on: Schema.Struct({
    push: Schema.optionalKey(Schema.Struct({ branches: Schema.Array(Schema.String) })),
    pull_request: Schema.Struct({ types: Schema.Array(Schema.String) }),
  }),
  jobs: Schema.Record(
    Schema.String,
    Schema.Struct({ "runs-on": Schema.Union([Schema.String, Schema.Array(Schema.String)]), steps: Schema.Array(Step) }),
  ),
});

export type ParsedWorkflow = typeof Workflow.Type;

export function parseWorkflow(text: string): ParsedWorkflow {
  return Schema.decodeUnknownSync(Workflow)(Bun.YAML.parse(text));
}

export function lastStep(workflow: ParsedWorkflow): Readonly<{ run: string; env: Readonly<Record<string, string>> }> {
  const steps = Object.values(workflow.jobs).flatMap((job) => job.steps);
  const last = steps.at(-1);
  if (last?.run === undefined) throw new Error("the last step of the parsed workflow carries no run");
  return { run: last.run, env: last.env ?? {} };
}

