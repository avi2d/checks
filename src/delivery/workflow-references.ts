import { fromProgram, shellCommands, type Command } from "./shell-command.ts";

export type Workflow = {
  readonly path: string;
  readonly document: unknown;
  readonly text: string;
};

export type MissingReference = {
  readonly location: string;
  readonly fault: string;
};

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function names(value: unknown): readonly string[] | undefined {
  if (typeof value === "string") return [value];
  if (!Array.isArray(value)) return undefined;
  return value.filter((entry): entry is string => typeof entry === "string");
}

type Locator = (needle: string, fallback: string) => string;

const RELEASE_BIN = "checks-release-pr";
const RELEASE_SOURCE = "release-pr.ts";
const REUSABLE_PREFIX = "./.github/workflows/";

function releaseArguments(program: Command): readonly string[] {
  const index = program.findIndex(
    (word) => word === RELEASE_BIN || word.endsWith(`/${RELEASE_BIN}`) || word === RELEASE_SOURCE || word.endsWith(`/${RELEASE_SOURCE}`),
  );
  if (index === -1) return [];
  return program.slice(index + 1).filter((word) => word.endsWith(".yml") || word.endsWith(".yaml"));
}

function lineOf(text: string, needle: string): number | undefined {
  const index = text.split("\n").findIndex((line) => line.includes(needle));
  return index === -1 ? undefined : index + 1;
}

function workflowTitle(document: unknown): string | undefined {
  return isRecord(document) && typeof document["name"] === "string" ? document["name"] : undefined;
}

function basename(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

function missingNeeds(jobs: Readonly<Record<string, unknown>>, at: Locator): readonly MissingReference[] {
  return Object.entries(jobs).flatMap(([id, job]) => {
    if (!isRecord(job)) return [];
    return (names(job["needs"]) ?? []).flatMap((need) =>
      need in jobs ? [] : [{ location: at(need, `job ${id}`), fault: `job ${id} needs missing job ${need}` }],
    );
  });
}

function missingTarget(uses: string, paths: ReadonlySet<string>, at: Locator, fallback: string): MissingReference | undefined {
  return uses.startsWith(REUSABLE_PREFIX) && !paths.has(uses.slice(2))
    ? { location: at(uses, fallback), fault: `names missing workflow ${uses.slice(2)}` }
    : undefined;
}

function missingJobRefs(
  id: string,
  job: unknown,
  files: ReadonlySet<string>,
  paths: ReadonlySet<string>,
  at: Locator,
): readonly MissingReference[] {
  if (!isRecord(job)) return [];
  const missing: MissingReference[] = [];
  if (typeof job["uses"] === "string") {
    const called = missingTarget(job["uses"], paths, at, `job ${id}`);
    if (called !== undefined) missing.push(called);
  }
  const steps = job["steps"];
  if (!Array.isArray(steps)) return missing;
  steps.forEach((step: unknown, index) => {
    if (!isRecord(step)) return;
    const fallback = `job ${id} step ${index + 1}`;
    if (typeof step["uses"] === "string") {
      const used = missingTarget(step["uses"], paths, at, fallback);
      if (used !== undefined) missing.push(used);
    }
    if (typeof step["run"] !== "string") return;
    for (const command of shellCommands(step["run"])) {
      for (const arg of releaseArguments(fromProgram(command))) {
        if (!files.has(basename(arg)) && ![...paths].some((path) => path.endsWith(`/${arg}`))) {
          missing.push({ location: at(arg, fallback), fault: `names missing workflow ${arg}` });
        }
      }
    }
  });
  return missing;
}

// A workflow_run entry names the workflow's name, not its file, so only a name in the repo satisfies it.
export function findMissingWorkflows(workflows: readonly Workflow[]): readonly MissingReference[] {
  const paths = new Set(workflows.map((workflow) => workflow.path));
  const files = new Set(workflows.map((workflow) => basename(workflow.path)));
  const titles = new Set(workflows.map((workflow) => workflowTitle(workflow.document) ?? basename(workflow.path)));
  return workflows.flatMap((workflow) => {
    const missing: MissingReference[] = [];
    const at: Locator = (needle, fallback) => {
      const line = lineOf(workflow.text, needle);
      return line === undefined ? `${workflow.path} ${fallback}` : `${workflow.path} line ${line}`;
    };
    const jobs = isRecord(workflow.document) ? workflow.document["jobs"] : undefined;
    if (isRecord(jobs)) {
      missing.push(...missingNeeds(jobs, at));
      for (const [id, job] of Object.entries(jobs)) missing.push(...missingJobRefs(id, job, files, paths, at));
    }
    const on = isRecord(workflow.document) ? workflow.document["on"] : undefined;
    const watched = isRecord(on) ? on["workflow_run"] : undefined;
    if (isRecord(watched)) {
      for (const entry of names(watched["workflows"]) ?? []) {
        if (!titles.has(entry)) missing.push({ location: at(entry, "on workflow_run"), fault: `names missing workflow ${entry}` });
      }
    }
    return missing;
  });
}

export function formatMissingReport(faults: readonly MissingReference[]): string {
  return [
    `ci-wiring: ${faults.length} reference(s) name a missing workflow or job:`,
    ...faults.map(({ location, fault }) => `  ${location}: ${fault}`),
  ].join("\n");
}
