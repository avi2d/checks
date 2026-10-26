import { Effect, FileSystem, Path, Schema } from "effect";
import { runsMutation, within, type Run } from "./mutation-job.ts";
import { isRecord, names, workflowJobs, workflowTitle, type Workflow } from "./workflow-references.ts";

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

function forkReachable(workflow: Workflow): boolean {
  const on = isRecord(workflow.document) ? workflow.document["on"] : undefined;
  const events = isRecord(on) ? Object.keys(on) : (names(on) ?? []);
  return events.some((event) => {
    const name = event.toLowerCase();
    return name === "pull_request" || name === "pull_request_target" || name === "pull_request_review" || name === "pull_request_review_comment" || name === "issue_comment";
  });
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

function mutationFault(runsOn: unknown, labels: readonly string[] | undefined, visibility: RunnerPolicy["visibility"], reachable: boolean): string | undefined {
  const pin = labels === undefined ? undefined : `[${labels.join(", ")}]`;
  if (readsOverride(runsOn)) {
    if (visibility === "public" && reachable) {
      return "a mutation job reads CI_RUNS_ON, so an override moves its mutation runs; set runs-on: ubuntu-latest";
    }
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

function declaredLabels(labels: readonly string[], runners: RunnerConfig): boolean {
  const declared = runners.mutation === undefined ? runners.selfHosted : [runners.mutation, ...runners.selfHosted];
  const wanted = labels.map((label) => label.toLowerCase());
  return wanted.length > 0 && declared.some((allowed) => wanted.every((label) => allowed.some((candidate) => candidate.toLowerCase() === label)));
}

function matrixKey(expression: string): string | undefined {
  const match = /^\$\{\{\s*matrix\s*\.\s*([\w-]+)\s*\}\}$/i.exec(expression.trim());
  return match?.[1]?.toLowerCase();
}

type Scalar = string | number | boolean;

type Combo = Map<string, unknown>;

type Terms = readonly (readonly [string, unknown])[];

function scalarList(value: unknown): readonly Scalar[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const kept = value.filter((entry): entry is Scalar => typeof entry === "string" || typeof entry === "number" || typeof entry === "boolean");
  return kept.length === value.length ? kept : undefined;
}

function matrixAxes(matrix: Readonly<Record<string, unknown>>): readonly (readonly [string, readonly Scalar[]])[] | undefined {
  const axes: (readonly [string, readonly Scalar[]])[] = [];
  for (const [name, axis] of Object.entries(matrix)) {
    const lowered = name.toLowerCase();
    if (lowered === "include" || lowered === "exclude") continue;
    const values = scalarList(axis);
    if (values === undefined) return undefined;
    axes.push([lowered, values]);
  }
  return axes;
}

function expandCombos(axes: readonly (readonly [string, readonly Scalar[]])[]): Combo[] | undefined {
  let combos: Combo[] = [new Map()];
  for (const [name, axis] of axes) {
    const next: Combo[] = [];
    for (const combo of combos) {
      for (const value of axis) next.push(new Map(combo).set(name, value));
    }
    combos = next;
    if (combos.length > 512) return undefined;
  }
  return combos;
}

function exclusionBlocks(excluded: unknown): readonly Terms[] | undefined {
  if (excluded === undefined) return [];
  if (!Array.isArray(excluded)) return undefined;
  const blocks: Terms[] = [];
  for (const candidate of excluded) {
    if (!isRecord(candidate)) return undefined;
    const terms: (readonly [string, unknown])[] = [];
    let usable = true;
    for (const [name, value] of Object.entries(candidate)) {
      if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") {
        usable = false;
        break;
      }
      terms.push([name.toLowerCase(), value]);
    }
    if (usable) blocks.push(terms);
  }
  return blocks;
}

function withoutExcluded(combos: readonly Combo[], blocks: readonly Terms[]): Combo[] {
  return combos.filter((combo) => !blocks.some((terms) => terms.every(([name, value]) => combo.get(name) === value)));
}

function includeEntries(candidate: Readonly<Record<string, unknown>>): Terms | undefined {
  const entries: (readonly [string, unknown])[] = [];
  for (const [name, value] of Object.entries(candidate)) {
    if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") return undefined;
    entries.push([name.toLowerCase(), value]);
  }
  return entries;
}

function mergeEntries(originals: readonly Combo[], axisNames: ReadonlySet<string>, entries: Terms, appended: Combo[]): void {
  const matches = originals.filter((combo) => entries.every(([name, value]) => !axisNames.has(name) || combo.get(name) === value));
  if (matches.length === 0) appended.push(new Map(entries));
  else for (const combo of matches) for (const [name, value] of entries) combo.set(name, value);
}

function applyInclude(originals: readonly Combo[], axisNames: ReadonlySet<string>, extra: unknown): readonly Combo[] | undefined {
  const appended: Combo[] = [];
  if (!Array.isArray(extra)) return appended;
  for (const candidate of extra) {
    if (!isRecord(candidate)) return undefined;
    const entries = includeEntries(candidate);
    if (entries === undefined) return undefined;
    mergeEntries(originals, axisNames, entries, appended);
  }
  return appended;
}

function runnerValues(combos: readonly Combo[], appended: readonly Combo[], key: string): readonly string[] | undefined {
  const used = new Set<string>();
  for (const combo of [...combos, ...appended]) {
    const value = combo.get(key);
    if (value === undefined) continue;
    if (typeof value !== "string") return undefined;
    used.add(value);
  }
  return used.size > 0 ? [...used] : undefined;
}

function matrixValues(job: Readonly<Record<string, unknown>>, key: string): readonly string[] | undefined {
  const strategy = job["strategy"];
  if (!isRecord(strategy)) return undefined;
  const matrix = strategy["matrix"];
  if (!isRecord(matrix)) return undefined;
  if (key === "include" || key === "exclude") return undefined;
  const axes = matrixAxes(matrix);
  if (axes === undefined) return undefined;
  const combos = expandCombos(axes);
  if (combos === undefined) return undefined;
  const blocks = exclusionBlocks(matrix["exclude"]);
  if (blocks === undefined) return undefined;
  const kept = withoutExcluded(combos, blocks);
  const appended = applyInclude(axes.length === 0 ? [] : kept, new Set(axes.map(([name]) => name)), matrix["include"]);
  if (appended === undefined) return undefined;
  return runnerValues(kept, appended, key);
}

function hasInterpolation(value: string): boolean {
  return value.includes("${{");
}

function mentionedSelfHosted(value: unknown): boolean {
  if (typeof value === "string") return /self-hosted/i.test(value);
  if (Array.isArray(value)) return value.some(mentionedSelfHosted);
  if (isRecord(value)) return Object.values(value).some(mentionedSelfHosted);
  return false;
}

function plainLabels(value: unknown): readonly string[] | undefined {
  if (typeof value === "string") return hasInterpolation(value) ? undefined : [value];
  if (!Array.isArray(value) || !value.every((entry): entry is string => typeof entry === "string")) return undefined;
  return value.some(hasInterpolation) ? undefined : value;
}

function matrixRefusal(
  job: Readonly<Record<string, unknown>>,
  shown: string,
  key: string,
  runners: RunnerConfig,
  selfHosted: string,
  unresolvable: (shown: string) => string,
): string | undefined {
  const values = matrixValues(job, key);
  if (values === undefined) return unresolvable(shown);
  for (const value of values) {
    if (hasInterpolation(value)) return mentionedSelfHosted(value) ? selfHosted : unresolvable(shown);
    if (value.toLowerCase() === "self-hosted" || declaredLabels([value], runners)) return selfHosted;
  }
  return undefined;
}

function stringFault(
  job: Readonly<Record<string, unknown>>,
  runsOn: string,
  runners: RunnerConfig,
  selfHosted: string,
  unresolvable: (shown: string) => string,
): string | undefined {
  const trimmed = runsOn.trim();
  const key = matrixKey(trimmed);
  if (key !== undefined) return matrixRefusal(job, trimmed, key, runners, selfHosted, unresolvable);
  if (hasInterpolation(trimmed)) return mentionedSelfHosted(trimmed) ? selfHosted : unresolvable(trimmed);
  return declaredLabels([trimmed], runners) ? selfHosted : undefined;
}

function arrayFault(runsOn: unknown, runners: RunnerConfig, selfHosted: string, unresolvable: (shown: string) => string): string | undefined {
  const labels = plainLabels(runsOn);
  if (labels === undefined) return mentionedSelfHosted(runsOn) ? selfHosted : unresolvable("its runs-on expression");
  return declaredLabels(labels, runners) ? selfHosted : undefined;
}

function scalarLabelsFault(runsOn: unknown, runners: RunnerConfig, selfHosted: string, unresolvable: (shown: string) => string): string | undefined {
  const labels = plainLabels(runsOn);
  if (labels === undefined) return unresolvable("its runs-on expression");
  return labels.some((label) => label.toLowerCase() === "self-hosted") || declaredLabels(labels, runners) ? selfHosted : undefined;
}

function recordFault(
  runsOn: Readonly<Record<string, unknown>>,
  runners: RunnerConfig,
  selfHosted: string,
  unresolvable: (shown: string) => string,
): string | undefined {
  if (runsOn["group"] === undefined) return scalarLabelsFault(runsOn["labels"], runners, selfHosted, unresolvable);
  const labels = plainLabels(runsOn["labels"]);
  if (labels !== undefined && (labels.some((label) => label.toLowerCase() === "self-hosted") || declaredLabels(labels, runners))) return selfHosted;
  const group = typeof runsOn["group"] === "string" ? runsOn["group"].trim() : "a runner group";
  return "a public repository runs a fork-reachable job on runner group " + group + ", which cannot be shown to be hosted before the run; set runs-on: ubuntu-latest";
}

function publicFault(job: Readonly<Record<string, unknown>>, runsOn: unknown, runners: RunnerConfig): string | undefined {
  const selfHosted = "a public repository runs a fork-reachable job on self-hosted labels, so a fork pull request would run its code there; set runs-on: ubuntu-latest";
  const unresolvable = (shown: string) =>
    "a public repository runs a fork-reachable job on " + shown + ", which cannot be shown to be a hosted runner before the run; set runs-on: ubuntu-latest";
  if (namesSelfHosted(runsOn)) return selfHosted;
  if (typeof runsOn === "string") return stringFault(job, runsOn, runners, selfHosted, unresolvable);
  if (Array.isArray(runsOn)) return arrayFault(runsOn, runners, selfHosted, unresolvable);
  if (isRecord(runsOn)) return recordFault(runsOn, runners, selfHosted, unresolvable);
  return unresolvable("its runs-on expression");
}

function calledWorkflow(job: Readonly<Record<string, unknown>>): string | undefined {
  const uses = job["uses"];
  return typeof uses === "string" && uses.startsWith("./.github/workflows/") ? uses.slice(2) : undefined;
}

function watchedWorkflows(workflow: Workflow): readonly string[] {
  const on = isRecord(workflow.document) ? workflow.document["on"] : undefined;
  const watched = isRecord(on) ? on["workflow_run"] : undefined;
  return isRecord(watched) ? (names(watched["workflows"]) ?? []) : [];
}

function runnerFault(job: Readonly<Record<string, unknown>>, runsOn: unknown, mutation: boolean, policy: RunnerPolicy, reachable: boolean): string | undefined {
  if (policy.visibility === "public" && reachable) {
    const fault = publicFault(job, runsOn, policy.runners);
    if (fault !== undefined) return fault;
  }
  return mutation ? mutationFault(runsOn, policy.runners.mutation, policy.visibility, reachable) : otherFault(runsOn, policy.runners, policy.visibility);
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
  const reachable = new Map(workflows.map((workflow) => [workflow.path, forkReachable(workflow)] as const));
  const titleOf = new Map(workflows.map((workflow) => [workflow.path, workflowTitle(workflow.document) ?? workflow.path] as const));
  let changed = true;
  while (changed) {
    changed = false;
    for (const workflow of workflows) {
      if (reachable.get(workflow.path) === true) continue;
      const called = workflows.some(
        (other) => reachable.get(other.path) === true && workflowJobs(other).some(([, job]) => calledWorkflow(job) === workflow.path),
      );
      const watched = watchedWorkflows(workflow).some((parent) =>
        workflows.some((other) => reachable.get(other.path) === true && titleOf.get(other.path) === parent),
      );
      if (called || watched) {
        reachable.set(workflow.path, true);
        changed = true;
      }
    }
  }
  return workflows.flatMap((workflow) =>
    workflowJobs(workflow).flatMap(([id, job]) => {
      if (job["runs-on"] === undefined) return [];
      const mutation = jobRuns(workflow, job).some((run) => runsMutation(run, policy.scripts, (file) => policy.files?.get(file)));
      const fault = runnerFault(job, job["runs-on"], mutation, policy, reachable.get(workflow.path) ?? forkReachable(workflow));
      return fault === undefined ? [] : [{ location: workflow.path + " job " + id, fault }];
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
