import { MUTATION_WORKFLOW } from "./full-set/mutation.ts";
import { runsMutation } from "./mutation-job.ts";
import { jobRuns } from "./runner-policy.ts";
import { WORKFLOWS } from "./site-names.ts";
import { workflowJobs, type Workflow } from "./workflow-references.ts";

export const MUTATION_PATH = `${WORKFLOWS}/mutation.yml`;

export type HandRolledJob = { readonly location: string };

export type MutationCalls = {
  readonly scripts: ReadonlyMap<string, string>;
  readonly files: ReadonlyMap<string, string>;
};

export const isWrittenMutation = (workflow: Workflow, expected: string): boolean => workflow.path === MUTATION_PATH && workflow.text === expected;

export function findHandRolledMutation(workflows: readonly Workflow[], calls: MutationCalls, expected = MUTATION_WORKFLOW): readonly HandRolledJob[] {
  return workflows
    .filter((workflow) => !isWrittenMutation(workflow, expected))
    .flatMap((workflow) =>
      workflowJobs(workflow).flatMap(([id, job]) =>
        jobRuns(workflow, job).some((run) => runsMutation(run, calls.scripts, (file) => calls.files.get(file))) ? [{ location: `${workflow.path} job ${id}` }] : [],
      ),
    );
}

export function formatHandRolledReport(jobs: readonly HandRolledJob[]): string {
  const fix = `run mutation only from the ${MUTATION_PATH} checks-setup writes`;
  return [`ci-wiring: ${jobs.length} job(s) run mutation outside the mutation workflow:`, ...jobs.map(({ location }) => `  ${location}: ${fix}`)].join("\n");
}
