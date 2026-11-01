import { documentPublishes } from "./release-preflight.ts";
import { fromProgram, shellWords } from "./shell-command.ts";
import { isRecord, locate, names, workflowJobs, type Workflow } from "./workflow-references.ts";

export type ScheduledRelease = {
  readonly location: string;
};

const RELEASE_BINS = ["pr", "push", "tag", "publish"].flatMap((bin) => [`checks-release-${bin}`, `release-${bin}.ts`]);

function isReleaseBin(word: string): boolean {
  return RELEASE_BINS.some((name) => word === name || word.endsWith(`/${name}`));
}

function callsReleaseBin(run: string): boolean {
  return shellWords(run).some((words) => {
    const [head = "", target = "", entry = ""] = fromProgram(words.map(({ text }) => text));
    return isReleaseBin(head === "bun" ? (target === "run" ? entry : target) : head);
  });
}

function schedules(document: unknown): boolean {
  const on = isRecord(document) ? document["on"] : undefined;
  return isRecord(on) ? "schedule" in on : (names(on) ?? []).includes("schedule");
}

function releases(workflow: Workflow): boolean {
  return (
    documentPublishes(workflow.document) ||
    workflowJobs(workflow).some(([, job]) => {
      const steps = Array.isArray(job["steps"]) ? job["steps"] : [];
      return steps.some((step: unknown) => isRecord(step) && typeof step["run"] === "string" && callsReleaseBin(step["run"]));
    })
  );
}

export function findScheduledReleases(workflows: readonly Workflow[]): readonly ScheduledRelease[] {
  return workflows
    .filter((workflow) => schedules(workflow.document) && releases(workflow))
    .map((workflow) => ({ location: locate(workflow.path, workflow.text.split("\n"))(["on"], "schedule", "on schedule") }));
}

export function formatScheduleReport(scheduled: readonly ScheduledRelease[]): string {
  return [
    `ci-wiring: ${scheduled.length} workflow(s) release on a schedule:`,
    ...scheduled.map(({ location }) => `  ${location}: drop the schedule, so a release runs only when someone starts it`),
  ].join("\n");
}
