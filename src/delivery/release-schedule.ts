import { runsBin } from "./mutation-job.ts";
import { jobRuns } from "./runner-policy.ts";
import type { Command } from "./shell-command.ts";
import { isRecord, localUses, locate, names, workflowJobs, type Workflow } from "./workflow-references.ts";

export type ScheduledRelease = {
  readonly location: string;
  readonly fault: string;
};

export type ScheduleContext = {
  readonly scripts: ReadonlyMap<string, string>;
  readonly files: ReadonlyMap<string, string>;
};

export type ScheduleOwner = {
  readonly visibility: "private" | "public" | "unknown";
  readonly publishes: boolean;
};

const RELEASE_BINS = ["pr", "push", "tag", "publish"].flatMap((bin) => [`checks-release-${bin}`, `release-${bin}.ts`]);
const PUBLISH_BINS = ["checks-release-publish", "release-publish.ts"];
const NUMBER = /^\d+$/;
const BY_HAND = "drop the schedule, so a release runs only when someone starts it";

function isBinIn(bins: readonly string[], word: string): boolean {
  return bins.some((name) => word === name || word.endsWith(`/${name}`));
}

function isPublishCommand([head = "", ...rest]: Command): boolean {
  return (head === "npm" && rest[0] === "publish") || isBinIn(PUBLISH_BINS, head);
}

function isReleaseCommand(program: Command): boolean {
  return isPublishCommand(program) || isBinIn(RELEASE_BINS, program[0] ?? "");
}

function workflowRuns(
  workflow: Workflow,
  context: ScheduleContext,
  isBin: (program: Command) => boolean,
  byPath: ReadonlyMap<string, Workflow>,
  walkedWorkflows: readonly string[],
): boolean {
  const files = (file: string) => context.files.get(file);
  if (
    workflowJobs(workflow)
      .flatMap(([, job]) => jobRuns(workflow, job))
      .some((run) => runsBin(run, context.scripts, files, isBin, true))
  )
    return true;
  return workflowJobs(workflow).some(([, job]) => {
    const called = localUses(job["uses"]);
    if (called === undefined || walkedWorkflows.includes(called)) return false;
    const next = byPath.get(called);
    return next !== undefined && workflowRuns(next, context, isBin, byPath, [...walkedWorkflows, called]);
  });
}

function crons(document: unknown): readonly unknown[] {
  const on = isRecord(document) ? document["on"] : undefined;
  const schedule = isRecord(on) ? on["schedule"] : undefined;
  return Array.isArray(schedule) ? schedule.map((entry) => (isRecord(entry) ? entry["cron"] : undefined)) : [];
}

// At most once a day is one minute and one hour, whatever the day, month and weekday fields allow.
export function atMostDaily(cron: unknown): boolean {
  if (typeof cron !== "string") return false;
  const fields = cron.trim().split(/\s+/);
  return fields.length === 5 && NUMBER.test(fields[0] ?? "") && NUMBER.test(fields[1] ?? "");
}

// A run outside CI cannot read whether the repository is private, so only a package.json that sets private refuses there.
function releaseFault(workflow: Workflow, owner: ScheduleOwner, publishesToNpm: boolean): string | undefined {
  if (owner.visibility === "private" || !owner.publishes || !publishesToNpm) return "only a public package that publishes to npm releases on a schedule; " + BY_HAND;
  const entries = crons(workflow.document);
  if (entries.length === 1 && entries.every(atMostDaily)) return undefined;
  return 'the release runs more than once a day; keep one cron at a minute and an hour, such as "7 3 * * *"';
}

export function schedules(document: unknown): boolean {
  const on = isRecord(document) ? document["on"] : undefined;
  return isRecord(on) ? "schedule" in on : (names(on) ?? []).includes("schedule");
}

export function releasesOnSchedule(workflows: readonly Workflow[], context: ScheduleContext): readonly Workflow[] {
  const byPath = new Map(workflows.map((workflow) => [workflow.path, workflow] as const));
  return workflows.filter((workflow) => schedules(workflow.document) && workflowRuns(workflow, context, isReleaseCommand, byPath, [workflow.path]));
}

export function findScheduledReleases(workflows: readonly Workflow[], context: ScheduleContext, owner: ScheduleOwner): readonly ScheduledRelease[] {
  const byPath = new Map(workflows.map((workflow) => [workflow.path, workflow] as const));
  const publishesToNpm = workflows.some((workflow) => workflowRuns(workflow, context, isPublishCommand, byPath, [workflow.path]));
  return releasesOnSchedule(workflows, context).flatMap((workflow) => {
    const fault = releaseFault(workflow, owner, publishesToNpm);
    return fault === undefined ? [] : [{ location: locate(workflow.path, workflow.text.split("\n"))(["on"], "schedule", "on schedule"), fault }];
  });
}

export function formatScheduleReport(scheduled: readonly ScheduledRelease[]): string {
  return [`ci-wiring: ${scheduled.length} workflow(s) release on a schedule:`, ...scheduled.map(({ location, fault }) => `  ${location}: ${fault}`)].join("\n");
}
