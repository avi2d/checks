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

type Locator = (needle: string, from: number, fallback: string, scoped?: (line: string) => boolean) => string;

const WORKFLOWS = ".github/workflows";
const RELEASE_BINS = ["checks-release-pr", "checks-release-tag"];
const RELEASE_SOURCES = ["release-pr.ts", "release-tag.ts"];
const REUSABLE_PREFIX = "./.github/workflows/";

function isPathTo(word: string, files: readonly string[]): boolean {
  return files.some((file) => word.endsWith(`/${file}`));
}

function releaseArguments(program: Command): readonly string[] {
  const [head, target] = program;
  if (head !== undefined && (RELEASE_BINS.includes(head) || isPathTo(head, RELEASE_BINS))) return program.slice(1);
  if (head === "bun" && target !== undefined && (RELEASE_SOURCES.includes(target) || isPathTo(target, [...RELEASE_SOURCES, ...RELEASE_BINS]))) {
    return program.slice(2);
  }
  return [];
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function keyLine(lines: readonly string[], key: string, from: number): number {
  const pattern = new RegExp(`^\\s*["']?${escapeRegExp(key)}["']?\\s*:\\s*(#.*)?$`);
  const index = lines.findIndex((line, at) => at >= from && pattern.test(line));
  return index === -1 ? from : index;
}

function candidateLines(lines: readonly string[], needle: string, from: number, scoped: (line: string) => boolean): readonly number[] {
  const hits = lines.flatMap((line, at) => (at >= from && line.includes(needle) ? [at] : []));
  const preferred = hits.filter((at) => scoped(lines[at] ?? ""));
  return [...preferred, ...hits.filter((at) => !preferred.includes(at))];
}

function locate(path: string, lines: readonly string[]): Locator {
  const used = new Map<string, number>();
  return (needle, from, fallback, scoped = (): boolean => true) => {
    const ordered = candidateLines(lines, needle, from, scoped);
    const at = ordered.find((line) => line > (used.get(needle) ?? -1)) ?? ordered[0];
    if (at === undefined) return `${path} ${fallback}`;
    used.set(needle, at);
    return `${path} line ${at + 1}`;
  };
}

function workflowTitle(document: unknown): string | undefined {
  return isRecord(document) && typeof document["name"] === "string" ? document["name"] : undefined;
}

function missingNeeds(
  jobs: Readonly<Record<string, unknown>>,
  at: Locator,
  starts: ReadonlyMap<string, number>,
): readonly MissingReference[] {
  return Object.entries(jobs).flatMap(([id, job]) => {
    if (!isRecord(job)) return [];
    const from = starts.get(id) ?? 0;
    return (names(job["needs"]) ?? []).flatMap((need) =>
      need in jobs ? [] : [{ location: at(need, from, `job ${id}`), fault: `job ${id} needs missing job ${need}` }],
    );
  });
}

function missingTarget(uses: string, paths: ReadonlySet<string>, at: Locator, from: number, fallback: string): MissingReference | undefined {
  return uses.startsWith(REUSABLE_PREFIX) && !paths.has(uses.slice(2))
    ? { location: at(uses, from, fallback), fault: `names missing workflow ${uses.slice(2)}` }
    : undefined;
}

function releaseLine(line: string): boolean {
  return [...RELEASE_BINS, ...RELEASE_SOURCES].some((release) => line.includes(release));
}

function missingJobRefs(
  id: string,
  job: unknown,
  paths: ReadonlySet<string>,
  at: Locator,
  from: number,
): readonly MissingReference[] {
  if (!isRecord(job)) return [];
  const missing: MissingReference[] = [];
  if (typeof job["uses"] === "string") {
    const called = missingTarget(job["uses"], paths, at, from, `job ${id}`);
    if (called !== undefined) missing.push(called);
  }
  const steps = job["steps"];
  if (!Array.isArray(steps)) return missing;
  steps.forEach((step: unknown, index) => {
    if (!isRecord(step)) return;
    const fallback = `job ${id} step ${index + 1}`;
    if (typeof step["uses"] === "string") {
      const used = missingTarget(step["uses"], paths, at, from, fallback);
      if (used !== undefined) missing.push(used);
    }
    if (typeof step["run"] !== "string") return;
    for (const command of shellCommands(step["run"])) {
      for (const arg of releaseArguments(fromProgram(command))) {
        if (arg.startsWith("-")) continue;
        if (!paths.has(`${WORKFLOWS}/${arg}`)) {
          missing.push({ location: at(arg, from, fallback, releaseLine), fault: `names missing workflow ${arg}` });
        }
      }
    }
  });
  return missing;
}

// GitHub names a workflow without a name by its path from the repository root.
export function findMissingWorkflows(workflows: readonly Workflow[]): readonly MissingReference[] {
  const paths = new Set(workflows.map((workflow) => workflow.path));
  const titles = new Set(workflows.map((workflow) => workflowTitle(workflow.document) ?? workflow.path));
  return workflows.flatMap((workflow) => {
    const missing: MissingReference[] = [];
    const lines = workflow.text.split("\n");
    const at = locate(workflow.path, lines);
    const jobs = isRecord(workflow.document) ? workflow.document["jobs"] : undefined;
    if (isRecord(jobs)) {
      const base = keyLine(lines, "jobs", 0);
      const starts = new Map(Object.keys(jobs).map((id) => [id, keyLine(lines, id, base)] as const));
      missing.push(...missingNeeds(jobs, at, starts));
      for (const [id, job] of Object.entries(jobs)) missing.push(...missingJobRefs(id, job, paths, at, starts.get(id) ?? base));
    }
    const on = isRecord(workflow.document) ? workflow.document["on"] : undefined;
    const watched = isRecord(on) ? on["workflow_run"] : undefined;
    if (isRecord(watched)) {
      const from = keyLine(lines, "workflow_run", 0);
      for (const entry of names(watched["workflows"]) ?? []) {
        if (!titles.has(entry)) missing.push({ location: at(entry, from, "on workflow_run"), fault: `names missing workflow ${entry}` });
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
