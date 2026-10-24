import { Effect, FileSystem, Path, Schema } from "effect";
import { runsMutation, within, type Run } from "./mutation-job.ts";
import { isRecord, names, workflowJobs, type Workflow } from "./workflow-references.ts";

export type RunnerConfig = {
  readonly mutation: readonly string[] | undefined;
  readonly selfHosted: readonly (readonly string[])[];
};

export type RunnerPolicy = {
  readonly visibility: "private" | "public" | "unknown";
  readonly runners: RunnerConfig;
  readonly scripts: ReadonlyMap<string, string>;
  readonly files?: ReadonlyMap<string, string>;
};

export type RunnerFault = {
  readonly location: string;
  readonly fault: string;
};

export class RunnerPolicyError extends Schema.TaggedError<RunnerPolicyError>()("RunnerPolicyError", {
  message: Schema.String,
}) {}

const Runners = Schema.Struct({
  mutationRunner: Schema.optional(Schema.NonEmptyArray(Schema.NonEmptyString)),
  selfHostedRunners: Schema.optional(Schema.Array(Schema.NonEmptyArray(Schema.NonEmptyString))),
});
const Manifest = Schema.Struct({
  scripts: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
  checks: Schema.optional(Runners),
});
// GitHub expressions match context and property names without regard to case.
const OVERRIDE_ACCESS = String.raw`vars\s*(?:\.\s*CI_RUNS_ON\b|\[\s*'CI_RUNS_ON'\s*\])`;
const RUNNER_OVERRIDE = new RegExp(String.raw`\b${OVERRIDE_ACCESS}`, "i");
const HOSTED_OVERRIDE = new RegExp(String.raw`^\$\{\{\s*${OVERRIDE_ACCESS}\s*\|\|\s*'ubuntu-latest'\s*\}\}$`, "i");
const HOSTED_DEFAULT = "${{ vars.CI_RUNS_ON || 'ubuntu-latest' }}";

function sameLabels(runsOn: unknown, labels: readonly string[]): boolean {
  const named = Array.isArray(runsOn) ? names(runsOn) : undefined;
  return named?.length === labels.length && labels.every((label) => named.includes(label));
}

function readsOverride(runsOn: unknown): boolean {
  if (typeof runsOn === "string") return RUNNER_OVERRIDE.test(runsOn);
  const values = isRecord(runsOn) ? Object.values(runsOn) : Array.isArray(runsOn) ? runsOn : [];
  return values.some(readsOverride);
}

// A fork reaches a job only through pull_request or pull_request_target, so only such a job can run untrusted code.
function forkReachable(workflow: Workflow): boolean {
  const on = isRecord(workflow.document) ? workflow.document["on"] : undefined;
  const events = isRecord(on) ? Object.keys(on) : (names(on) ?? []);
  return events.some((event) => event.toLowerCase() === "pull_request" || event.toLowerCase() === "pull_request_target");
}

// An exact match would let a differently cased label slip past the refusal.
function namesSelfHosted(runsOn: unknown): boolean {
  if (typeof runsOn === "string") return runsOn.trim().toLowerCase() === "self-hosted";
  if (Array.isArray(runsOn)) return runsOn.some((label) => typeof label === "string" && label.toLowerCase() === "self-hosted");
  if (isRecord(runsOn)) {
    const labels = runsOn["labels"];
    return Array.isArray(labels) && labels.some((label) => typeof label === "string" && label.toLowerCase() === "self-hosted");
  }
  return false;
}

function mutationFault(runsOn: unknown, labels: readonly string[] | undefined, visibility: RunnerPolicy["visibility"]): string | undefined {
  const pin = labels === undefined ? undefined : `[${labels.join(", ")}]`;
  if (readsOverride(runsOn)) {
    return pin === undefined
      ? "a mutation job reads CI_RUNS_ON, so an override moves its mutation runs; declare the mutation runner labels in package.json checks.mutationRunner"
      : `a mutation job reads CI_RUNS_ON, so an override moves its mutation runs off ${pin}; set runs-on: ${pin}`;
  }
  if (visibility !== "private") return undefined;
  if (labels === undefined) {
    return "a mutation job in a private repository names no checks.mutationRunner in package.json; declare the mutation runner labels there";
  }
  return sameLabels(runsOn, labels) ? undefined : `a mutation job in a private repository runs off ${pin}; set runs-on: ${pin}`;
}

function otherFault(runsOn: unknown, runners: RunnerConfig, visibility: RunnerPolicy["visibility"]): string | undefined {
  const hosted = typeof runsOn === "string" && HOSTED_OVERRIDE.test(runsOn.trim());
  if (hosted || runners.selfHosted.some((allowed) => sameLabels(runsOn, allowed))) return undefined;
  if (visibility !== "private" && !readsOverride(runsOn)) return undefined;
  return `the job is not on a hosted runner CI_RUNS_ON can override; set runs-on: ${HOSTED_DEFAULT}`;
}

function runnerFault(runsOn: unknown, mutation: boolean, policy: RunnerPolicy, reachable: boolean): string | undefined {
  // A fork pull request would run its own code on the runner.
  if (policy.visibility === "public" && reachable && namesSelfHosted(runsOn)) {
    return `a public repository runs a fork-reachable job on self-hosted labels, so a fork pull request would run its code there; set runs-on: ${HOSTED_DEFAULT}`;
  }
  return mutation ? mutationFault(runsOn, policy.runners.mutation, policy.visibility) : otherFault(runsOn, policy.runners, policy.visibility);
}

function stepDirectory(value: unknown, inherited: string | undefined): string | undefined {
  if (value === undefined) return inherited;
  return typeof value === "string" ? within("", value) : undefined;
}

function defaultDirectory(node: unknown, inherited: string | undefined): string | undefined {
  const defaults = isRecord(node) ? node["defaults"] : undefined;
  const run = isRecord(defaults) ? defaults["run"] : undefined;
  return stepDirectory(isRecord(run) ? run["working-directory"] : undefined, inherited);
}

export function jobRuns(workflow: Workflow, job: Readonly<Record<string, unknown>>): readonly Run[] {
  const dir = defaultDirectory(job, defaultDirectory(workflow.document, ""));
  const steps = Array.isArray(job["steps"]) ? job["steps"] : [];
  return steps.flatMap((step: unknown) => (isRecord(step) && typeof step["run"] === "string" ? [{ script: step["run"], dir: stepDirectory(step["working-directory"], dir) }] : []));
}

export function findRunnerFaults(policy: RunnerPolicy, workflows: readonly Workflow[]): readonly RunnerFault[] {
  return workflows.flatMap((workflow) =>
    workflowJobs(workflow).flatMap(([id, job]) => {
      if (job["runs-on"] === undefined) return [];
      const mutation = jobRuns(workflow, job).some((run) => runsMutation(run, policy.scripts, (file) => policy.files?.get(file)));
      const fault = runnerFault(job["runs-on"], mutation, policy, forkReachable(workflow));
      return fault === undefined ? [] : [{ location: `${workflow.path} job ${id}`, fault }];
    }),
  );
}

export function formatRunnerReport(faults: readonly RunnerFault[]): string {
  return [`ci-wiring: ${faults.length} job(s) run on the wrong runner:`, ...faults.map(({ location, fault }) => `  ${location}: ${fault}`)].join("\n");
}

export const readRunnerConfig = Effect.fn("readRunnerConfig")(function* (root: string) {
  const fs = yield* FileSystem.FileSystem;
  const file = (yield* Path.Path).join(root, "package.json");
  if (!(yield* fs.exists(file))) return { mutation: undefined, selfHosted: [] } satisfies RunnerConfig;
  const { checks } = yield* fs.readFileString(file).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(Schema.fromJsonString(Manifest))),
    Effect.mapError((cause) => new RunnerPolicyError({ message: `cannot read ${file}: ${cause.message}` })),
  );
  return { mutation: checks?.mutationRunner, selfHosted: checks?.selfHostedRunners ?? [] } satisfies RunnerConfig;
});
