import { Schema } from "effect";

const Step = Schema.Struct({
  name: Schema.optionalKey(Schema.String),
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

export function stepNamed(workflow: ParsedWorkflow, name: string): Readonly<{ run: string; env: Readonly<Record<string, string>> }> {
  const step = Object.values(workflow.jobs)
    .flatMap((job) => job.steps)
    .find((one) => one.name === name);
  if (step?.run === undefined) throw new Error(`the parsed workflow has no step named ${name} that carries a run`);
  return { run: step.run, env: step.env ?? {} };
}

