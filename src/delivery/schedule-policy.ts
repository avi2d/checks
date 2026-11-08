import { runsBin } from "./mutation-job.ts";
import { SHARED_REPOSITORY } from "./mutation-workflow.ts";
import { crons, isBinIn, releasesOnSchedule, schedules } from "./release-schedule.ts";
import { jobRuns } from "./runner-policy.ts";
import { invokes, plainCommand, type Command } from "./shell-command.ts";
import { locate, workflowJobs, type Workflow } from "./workflow-references.ts";
import type { ScheduleContext, ScheduleOwner } from "./release-schedule.ts";

export type ScheduledRun = {
  readonly location: string;
  readonly fault: string;
};

const ADVISORY_BINS = ["checks-advisories", "advisories.ts"];
const INSTALL = ["bun", "install"];
const ADVISORIES_CALL = /^([^/]+\/[^/]+)\/\.github\/workflows\/advisories\.yml@[^@\s]+$/;
const NUMBER = /^\d+$/;
const WEEKDAY = /^(?:[0-7]|sun|mon|tue|wed|thu|fri|sat)$/i;
const BY_HAND = "drop the schedule, so it runs only when someone starts it with gh workflow run";

function isAdvisoryBin([head = ""]: Command): boolean {
  return isBinIn(ADVISORY_BINS, head);
}

// Once a week is one minute, one hour and one weekday, on any day of any month.
export function weekly(cron: unknown): boolean {
  if (typeof cron !== "string") return false;
  const [minute = "", hour = "", day = "", month = "", weekday = "", ...rest] = cron.trim().split(/\s+/);
  return rest.length === 0 && NUMBER.test(minute) && NUMBER.test(hour) && day === "*" && month === "*" && WEEKDAY.test(weekday);
}

// GitHub matches an owner and a repository name in any case.
function callsSharedAdvisories(uses: string): boolean {
  return ADVISORIES_CALL.exec(uses)?.[1]?.toLowerCase() === SHARED_REPOSITORY;
}

function scansAdvisoriesOnly(workflow: Workflow, context: ScheduleContext): boolean {
  const files = (file: string) => context.files.get(file);
  const jobs = workflowJobs(workflow);
  const calls = jobs.flatMap(([, job]) => (typeof job["uses"] === "string" ? [callsSharedAdvisories(job["uses"])] : []));
  const runs = jobs.flatMap(([, job]) => jobRuns(workflow, job));
  const scans = runs.filter((run) => runsBin(run, context.scripts, files, isAdvisoryBin, true));
  const scanned = scans.length > 0 || calls.includes(true);
  return scanned && calls.every(Boolean) && runs.every((run) => scans.includes(run) || invokes(plainCommand(run.script), INSTALL));
}

function advisoryFault(workflow: Workflow, owner: ScheduleOwner): string | undefined {
  if (owner.visibility === "private") return "a private repository scans advisories by hand; " + BY_HAND;
  const entries = crons(workflow.document);
  if (entries.length === 1 && entries.every(weekly)) return undefined;
  return 'the advisory scan runs more than once a week; keep one cron at a minute, an hour and a weekday, such as "15 5 * * 1"';
}

// A workflow that releases on a schedule is the release rule's to judge, so this rule passes over it.
export function findScheduledRuns(workflows: readonly Workflow[], context: ScheduleContext, owner: ScheduleOwner): readonly ScheduledRun[] {
  const releasing = new Set(releasesOnSchedule(workflows, context));
  return workflows.flatMap((workflow) => {
    if (!schedules(workflow.document) || releasing.has(workflow)) return [];
    const fault = scansAdvisoriesOnly(workflow, context) ? advisoryFault(workflow, owner) : BY_HAND;
    if (fault === undefined) return [];
    return [{ location: locate(workflow.path, workflow.text.split("\n"))(["on"], "schedule", "on schedule"), fault }];
  });
}

export function formatScheduledRunReport(scheduled: readonly ScheduledRun[]): string {
  return [`ci-wiring: ${scheduled.length} workflow(s) run on a schedule:`, ...scheduled.map(({ location, fault }) => `  ${location}: ${fault}`)].join("\n");
}
