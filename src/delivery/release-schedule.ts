import { documentPublishes } from "./release-preflight.ts";
import { fromProgram, shellWords } from "./shell-command.ts";
import { isRecord, locate, names, workflowJobs, type Workflow } from "./workflow-references.ts";

export type ScheduledRelease = {
  readonly location: string;
};

const RELEASE_PR = ["checks-release-pr", "release-pr.ts"];

function isReleasePr(word: string): boolean {
  return RELEASE_PR.some((name) => word === name || word.endsWith(`/${name}`));
}

function callsReleasePr(run: string): boolean {
  return shellWords(run).some((words) => {
    const [head = "", target = "", entry = ""] = fromProgram(words.map(({ text }) => text));
    return isReleasePr(head === "bun" ? (target === "run" ? entry : target) : head);
  });
}

function schedules(document: unknown): boolean {
  const on = isRecord(document) ? document["on"] : undefined;
  return isRecord(on) ? "schedule" in on : (names(on) ?? []).includes("schedule");
}

function runsReleasePr(workflow: Workflow): boolean {
  return workflowJobs(workflow).some(([, job]) => {
    const steps = Array.isArray(job["steps"]) ? job["steps"] : [];
    return steps.some((step: unknown) => isRecord(step) && typeof step["run"] === "string" && callsReleasePr(step["run"]));
  });
}

export function findScheduledReleases(workflows: readonly Workflow[]): readonly ScheduledRelease[] {
  if (workflows.some((workflow) => documentPublishes(workflow.document))) return [];
  return workflows
    .filter((workflow) => schedules(workflow.document) && runsReleasePr(workflow))
    .map((workflow) => ({ location: locate(workflow.path, workflow.text.split("\n"))(["on"], "schedule", "on schedule") }));
}

export function formatScheduleReport(scheduled: readonly ScheduledRelease[]): string {
  return [
    `ci-wiring: ${scheduled.length} workflow(s) schedule checks-release-pr, but no workflow publishes to npm:`,
    ...scheduled.map(({ location }) => `  ${location}: drop the schedule, so the release pull request opens only when someone runs the workflow`),
  ].join("\n");
}
