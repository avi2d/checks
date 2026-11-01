import { documentPublishes } from "./release-preflight.ts";
import { runsBin } from "./mutation-job.ts";
import { jobRuns } from "./runner-policy.ts";
import type { Command } from "./shell-command.ts";
import { isRecord, locate, names, workflowJobs, type Workflow } from "./workflow-references.ts";

export type ScheduledRelease = {
  readonly location: string;
};

export type ScheduleContext = {
  readonly scripts: ReadonlyMap<string, string>;
  readonly files: ReadonlyMap<string, string>;
};

const EMPTY: ScheduleContext = { scripts: new Map(), files: new Map() };

const RELEASE_BINS = ["pr", "push", "tag", "publish"].flatMap((bin) => [`checks-release-${bin}`, `release-${bin}.ts`]);

function isReleaseBin(word: string): boolean {
  return RELEASE_BINS.some((name) => word === name || word.endsWith(`/${name}`));
}

function isReleaseCommand(program: Command): boolean {
  const [head = "", ...rest] = program;
  if (head === "npm" && rest[0] === "publish") return true;
  return isReleaseBin(head);
}

function localUses(job: Readonly<Record<string, unknown>>): string | undefined {
  const uses = job["uses"];
  return typeof uses === "string" && uses.startsWith("./") ? uses.slice(2) : undefined;
}

function workflowReleases(
  workflow: Workflow,
  context: ScheduleContext,
  byPath: ReadonlyMap<string, Workflow>,
  walkedWorkflows: readonly string[],
): boolean {
  if (documentPublishes(workflow.document)) return true;
  const files = (file: string) => context.files.get(file);
  if (
    workflowJobs(workflow)
      .flatMap(([, job]) => jobRuns(workflow, job))
      .some((run) => runsBin(run, context.scripts, files, isReleaseCommand))
  )
    return true;
  return workflowJobs(workflow).some(([, job]) => {
    const called = localUses(job);
    if (called === undefined || walkedWorkflows.includes(called)) return false;
    const next = byPath.get(called);
    return next !== undefined && workflowReleases(next, context, byPath, [...walkedWorkflows, called]);
  });
}

function schedules(document: unknown): boolean {
  const on = isRecord(document) ? document["on"] : undefined;
  return isRecord(on) ? "schedule" in on : (names(on) ?? []).includes("schedule");
}

export function findScheduledReleases(workflows: readonly Workflow[], context: ScheduleContext = EMPTY): readonly ScheduledRelease[] {
  const byPath = new Map(workflows.map((workflow) => [workflow.path, workflow] as const));
  return workflows
    .filter((workflow) => schedules(workflow.document) && workflowReleases(workflow, context, byPath, [workflow.path]))
    .map((workflow) => ({ location: locate(workflow.path, workflow.text.split("\n"))(["on"], "schedule", "on schedule") }));
}

export function formatScheduleReport(scheduled: readonly ScheduledRelease[]): string {
  return [
    `ci-wiring: ${scheduled.length} workflow(s) release on a schedule:`,
    ...scheduled.map(({ location }) => `  ${location}: drop the schedule, so a release runs only when someone starts it`),
  ].join("\n");
}
