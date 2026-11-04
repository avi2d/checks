import { runsBin } from "./mutation-job.ts";
import type { ScheduleContext } from "./release-schedule.ts";
import { jobRuns } from "./runner-policy.ts";
import type { Command } from "./shell-command.ts";
import { workflowJobs, type Workflow } from "./workflow-references.ts";

const NIGHT_STEP = "checks-lint --night";

export type NightStepFault = {
  readonly gate: string;
};

const NIGHT_BINS = ["checks-lint", "core/lint.ts"];

function isNightLint([head = "", ...rest]: Command): boolean {
  return NIGHT_BINS.some((name) => head === name || head.endsWith("/" + name)) && rest.includes("--night");
}

function localUses(job: Readonly<Record<string, unknown>>): string | undefined {
  const uses = job["uses"];
  return typeof uses === "string" && uses.startsWith("./") ? uses.slice(2) : undefined;
}

function workflowRunsNightStep(
  workflow: Workflow,
  context: ScheduleContext,
  byPath: ReadonlyMap<string, Workflow>,
  walkedWorkflows: readonly string[],
): boolean {
  const files = (file: string) => context.files.get(file);
  if (
    workflowJobs(workflow)
      .flatMap(([, job]) => jobRuns(workflow, job))
      .some((run) => runsBin(run, context.scripts, files, isNightLint, true))
  )
    return true;
  return workflowJobs(workflow).some(([, job]) => {
    const called = localUses(job);
    if (called === undefined || walkedWorkflows.includes(called)) return false;
    const next = byPath.get(called);
    return next !== undefined && workflowRunsNightStep(next, context, byPath, [...walkedWorkflows, called]);
  });
}

function runsNightStep(workflows: readonly Workflow[], context: ScheduleContext): boolean {
  const byPath = new Map(workflows.map((workflow) => [workflow.path, workflow] as const));
  return workflows.some((workflow) => workflowRunsNightStep(workflow, context, byPath, [workflow.path]));
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
