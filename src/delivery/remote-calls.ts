import { workflowJobs, type Workflow } from "./workflow-references.ts";

export type RemoteCall = { readonly path: string; readonly job: string; readonly uses: string };

const REMOTE_WORKFLOW = /^[^./\s][^/\s]*\/[^/\s]+\/\.github\/workflows\/[^@\s]+@\S+$/;

export function remoteCallsOf(workflows: readonly Workflow[]): readonly RemoteCall[] {
  return workflows.flatMap((workflow) =>
    workflowJobs(workflow).flatMap(([job, body]) => {
      const uses = body["uses"];
      return typeof uses === "string" && REMOTE_WORKFLOW.test(uses.trim()) ? [{ path: workflow.path, job, uses: uses.trim() }] : [];
    }),
  );
}

export function remoteCallLines(calls: readonly RemoteCall[]): readonly string[] {
  return calls.map(({ path, job, uses }) => `  ${path} job ${job}: calls ${uses}, a workflow of another repository, where the set holds every step itself`);
}
