import { names, type Workflow } from "./workflow-references.ts";

const NEEDS_RUNS_ON = /^\$\{\{\s*needs\.([\w-]+)\.outputs\.runs-on\s*\}\}$/i;
const SHARED_RUNNER = /^avi2d\/workflows\/\.github\/workflows\/runner\.ya?ml@[0-9a-f]{40}$/i;
const LOCAL_RUNNER = new Set([".github/workflows/runner.yml", ".github/workflows/runner.yaml"]);

function callsRunnerPick(uses: unknown, workflows: readonly Workflow[]): boolean {
  if (typeof uses !== "string") return false;
  const target = uses.trim();
  if (target.startsWith("./")) {
    const path = target.slice(2);
    return LOCAL_RUNNER.has(path) && workflows.some((workflow) => workflow.path === path);
  }
  return SHARED_RUNNER.test(target);
}

// GitHub fills needs.<job> only for jobs the current job needs.
export function readsRunnerPick(
  job: Readonly<Record<string, unknown>>,
  runsOn: unknown,
  jobs: ReadonlyMap<string, Readonly<Record<string, unknown>>>,
  workflows: readonly Workflow[],
): boolean {
  if (typeof runsOn !== "string") return false;
  const need = NEEDS_RUNS_ON.exec(runsOn.trim())?.[1];
  if (need === undefined) return false;
  if (!(names(job["needs"]) ?? []).includes(need)) return false;
  return callsRunnerPick(jobs.get(need)?.["uses"], workflows);
}
