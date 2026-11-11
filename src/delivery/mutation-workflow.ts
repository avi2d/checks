import { runsMutation } from "./mutation-job.ts";
import { jobRuns } from "./runner-policy.ts";
import { workflowJobs, type Workflow } from "./workflow-references.ts";

export const SHARED_REPOSITORY = "avi2d/workflows";
export const SHARED_MUTATION = `${SHARED_REPOSITORY}/.github/workflows/mutation.yml@v2`;

export type HandRolledJob = { readonly location: string };

export type MutationCalls = {
  readonly scripts: ReadonlyMap<string, string>;
  readonly files: ReadonlyMap<string, string>;
};

// GitHub matches an owner and a repository name in any case.
const holdsSharedWorkflow = (repository: string | undefined): boolean => repository?.toLowerCase() === SHARED_REPOSITORY;

export function findHandRolledMutation(workflows: readonly Workflow[], calls: MutationCalls, repository: string | undefined): readonly HandRolledJob[] {
  if (holdsSharedWorkflow(repository)) return [];
  return workflows.flatMap((workflow) =>
    workflowJobs(workflow).flatMap(([id, job]) =>
      jobRuns(workflow, job).some((run) => runsMutation(run, calls.scripts, (file) => calls.files.get(file))) ? [{ location: `${workflow.path} job ${id}` }] : [],
    ),
  );
}

export function formatHandRolledReport(jobs: readonly HandRolledJob[]): string {
  const fix = `run mutation through a job with uses: ${SHARED_MUTATION}, as checks-setup writes it`;
  return [`ci-wiring: ${jobs.length} job(s) run mutation outside the shared workflow:`, ...jobs.map(({ location }) => `  ${location}: ${fix}`)].join("\n");
}
