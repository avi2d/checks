import { runsBin } from "./mutation-job.ts";
import type { ScheduleContext } from "./release-schedule.ts";
import { jobRuns } from "./runner-policy.ts";
import type { Command } from "./shell-command.ts";
import { isRecord, names, skippedBy, switchedOff, type Workflow } from "./workflow-references.ts";

const NIGHT_STEP = "checks-lint --night";

export type NightStepFault = {
  readonly gate: string;
};

const NIGHT_BINS = ["checks-lint", "core/lint.ts"];

function isNightLint([head = "", ...rest]: Command): boolean {
  return NIGHT_BINS.some((name) => head === name || head.endsWith("/" + name)) && rest.length === 1 && rest[0] === "--night";
}

function localUses(job: Readonly<Record<string, unknown>>): string | undefined {
  const uses = job["uses"];
  return typeof uses === "string" && uses.startsWith("./") ? uses.slice(2) : undefined;
}

function rootBlocker(workflow: Workflow): string | undefined {
  const on = isRecord(workflow.document) ? workflow.document["on"] : undefined;
  const events = isRecord(on) ? Object.keys(on) : (names(on) ?? []);
  if (events.length > 0 && events.every((event) => event.toLowerCase() === "workflow_call")) {
    return `${workflow.path} runs only when called`;
  }
  return undefined;
}

function workflowRunsNightStep(
  workflow: Workflow,
  context: ScheduleContext,
  byPath: ReadonlyMap<string, Workflow>,
  walkedWorkflows: readonly string[],
  inherited: string | undefined,
): boolean {
  const files = (file: string) => context.files.get(file);
  const jobs = isRecord(workflow.document) ? workflow.document["jobs"] : undefined;
  if (!isRecord(jobs)) return false;
  return Object.entries(jobs).some(([id, job]) => {
    if (!isRecord(job)) return false;
    const skipped = skippedBy(jobs, id, []);
    const jobBlocker =
      inherited ?? switchedOff(job, `job ${id}`) ?? (skipped === undefined ? undefined : `job ${id} needs a job that never runs: ${skipped}`);
    const steps = Array.isArray(job["steps"]) ? job["steps"] : [];
    const runRecords: readonly Readonly<Record<string, unknown>>[] = steps.flatMap((step: unknown) =>
      isRecord(step) && typeof step["run"] === "string" ? [step] : [],
    );
    const unblocked = jobRuns(workflow, job).some(
      (run, index) =>
        (jobBlocker ?? switchedOff(runRecords[index] ?? {}, "the step")) === undefined &&
        runsBin(run, context.scripts, files, isNightLint, true),
    );
    if (unblocked) return true;
    const called = localUses(job);
    if (called === undefined || walkedWorkflows.includes(called)) return false;
    const next = byPath.get(called);
    return next !== undefined && workflowRunsNightStep(next, context, byPath, [...walkedWorkflows, called], jobBlocker);
  });
}

function runsNightStep(workflows: readonly Workflow[], context: ScheduleContext): boolean {
  const byPath = new Map(workflows.map((workflow) => [workflow.path, workflow] as const));
  return workflows.some((workflow) => workflowRunsNightStep(workflow, context, byPath, [workflow.path], rootBlocker(workflow)));
}

export function findNightStepFaults(
  tracksTypeScript: boolean,
  workflows: readonly Workflow[],
  context: ScheduleContext,
): readonly NightStepFault[] {
  return tracksTypeScript && !runsNightStep(workflows, context) ? [{ gate: NIGHT_STEP }] : [];
}

export function formatNightStepReport(faults: readonly NightStepFault[]): string {
  return [
    "ci-wiring: " + faults.length + " gate(s) never run on the night run:",
    ...faults.flatMap(({ gate }) => ["  " + gate, "    no run step invokes it"]),
  ].join("\n");
}
