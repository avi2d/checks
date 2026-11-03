import { workflowJobs, type Workflow } from "./workflow-references.ts";

export type LongJob = {
  readonly location: string;
  readonly fault: string;
};

const LIMIT = 60;
const SET = `set timeout-minutes to a number of at most ${LIMIT}`;

function timeoutFault(timeout: unknown): string | undefined {
  if (timeout === undefined) return "the job sets no timeout-minutes, so a hung run holds its runner for GitHub's 360 minute default; " + SET;
  if (typeof timeout !== "number") return "its timeout-minutes cannot be shown to stay within an hour before the run; " + SET;
  return timeout > LIMIT ? `its timeout-minutes of ${timeout} lets the job run for hours; ${SET}` : undefined;
}

// A job that calls a reusable workflow cannot set timeout-minutes, and the called workflow's own jobs are judged where it lives.
export function findLongJobs(workflows: readonly Workflow[]): readonly LongJob[] {
  return workflows.flatMap((workflow) =>
    workflowJobs(workflow).flatMap(([id, job]) => {
      if (job["uses"] !== undefined) return [];
      const fault = timeoutFault(job["timeout-minutes"]);
      return fault === undefined ? [] : [{ location: `${workflow.path} job ${id}`, fault }];
    }),
  );
}

export function formatLongJobReport(jobs: readonly LongJob[]): string {
  return [`ci-wiring: ${jobs.length} job(s) can run for hours:`, ...jobs.map(({ location, fault }) => `  ${location}: ${fault}`)].join("\n");
}
