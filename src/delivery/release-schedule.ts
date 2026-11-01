import { documentPublishes } from "./release-preflight.ts";
import { fromProgram, SHELLS, shellCommands, type Command } from "./shell-command.ts";
import { within } from "./mutation-job.ts";
import { isRecord, locate, names, workflowJobs, type Workflow } from "./workflow-references.ts";

export type ScheduledRelease = {
  readonly location: string;
};

export type ScheduleContext = {
  readonly scripts: ReadonlyMap<string, string>;
  readonly files: ReadonlyMap<string, string>;
};

const EMPTY: ScheduleContext = { scripts: new Map(), files: new Map() };

const RELEASE_BINS = ["pr", "push", "tag", "publish"].flatMap((bin) => [`checks-release-${bin}`, `release-${bin}.ts`]);

function isReleaseBin(word: string): boolean {
  return RELEASE_BINS.some((name) => word === name || word.endsWith(`/${name}`));
}

function isShell(program: string): boolean {
  return SHELLS.includes(program.slice(program.lastIndexOf("/") + 1));
}

function skipOptions(words: readonly string[]): readonly string[] {
  const kept = [...words];
  while (kept.length > 0 && kept[0]?.startsWith("-")) {
    const option = kept.shift();
    if (option === "--cwd" && kept.length > 0 && !kept[0]?.startsWith("-")) kept.shift();
  }
  return kept;
}

function bunTarget(program: Command): string | undefined {
  const rest = skipOptions(program.slice(1));
  if (rest[0] === "x") return skipOptions(rest.slice(1))[0];
  if (rest[0] === "run") return skipOptions(rest.slice(1))[0];
  return rest[0];
}

function isDirectRelease(program: Command): boolean {
  const [head = "", ...rest] = program;
  if (head === "npm" && rest[0] === "publish") return true;
  if (isReleaseBin(head)) return true;
  if (head === "bun") {
    const words = skipOptions(program.slice(1));
    if (words[0] === "x") return isReleaseBin(skipOptions(words.slice(1))[0] ?? "");
    return isReleaseBin(bunTarget(program) ?? "");
  }
  return false;
}

function scriptName(program: Command): string | undefined {
  const [head = "", ...rest] = program;
  if (head === "bun") return bunTarget(program);
  if (head === "npm" && rest[0] === "run") return rest[1];
  return undefined;
}

function stepDirectory(value: unknown, inherited: string | undefined): string | undefined {
  if (value === undefined) return inherited;
  return typeof value === "string" ? within("", value) : undefined;
}

function defaultDirectory(node: unknown, inherited: string | undefined): string | undefined {
  const defaults = isRecord(node) ? node["defaults"] : undefined;
  const run = isRecord(defaults) ? defaults["run"] : undefined;
  return stepDirectory(isRecord(run) ? run["working-directory"] : undefined, inherited);
}

function bunDirectory(program: Command, dir: string | undefined): string | undefined {
  let current = dir;
  const words = program.slice(1);
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index] ?? "";
    if (word === "--cwd") {
      const value = words[index + 1];
      if (value !== undefined && !value.startsWith("-")) current = within(current, value);
    } else if (word.startsWith("--cwd=")) {
      current = within(current, word.slice("--cwd=".length));
    }
  }
  return current;
}

function fileCandidates(program: Command, dir: string | undefined): readonly string[] {
  const [head = "", ...rest] = program;
  if (head === "bun") {
    const target = bunTarget(program);
    if (target === undefined || target.startsWith("-")) return [];
    const resolved = within(bunDirectory(program, dir), target);
    return resolved === undefined ? [] : [resolved];
  }
  if (isShell(head) && rest[0] !== undefined) {
    const resolved = within(dir, rest[0]);
    return resolved === undefined ? [] : [resolved];
  }
  if (head.includes("/")) {
    const resolved = within(dir, head);
    return resolved === undefined ? [] : [resolved];
  }
  return [];
}

type Walked = {
  readonly scripts: readonly string[];
  readonly files: readonly string[];
};

function scriptReleases(
  script: string,
  dir: string | undefined,
  context: ScheduleContext,
  walked: Walked,
  byPath: ReadonlyMap<string, Workflow>,
  walkedWorkflows: readonly string[],
): boolean {
  let cwd = dir;
  for (const command of shellCommands(script)) {
    const [program = "", ...args] = fromProgram(command);
    if (program === "cd") {
      const [target] = args.filter((word) => !word.startsWith("-"));
      cwd = target === undefined || target === "-" ? undefined : within(cwd, target);
      continue;
    }
    if (commandReleases(command, cwd, context, walked, byPath, walkedWorkflows)) return true;
  }
  return false;
}

function commandReleases(
  command: Command,
  dir: string | undefined,
  context: ScheduleContext,
  walked: Walked,
  byPath: ReadonlyMap<string, Workflow>,
  walkedWorkflows: readonly string[],
): boolean {
  const program = fromProgram(command);
  if (isDirectRelease(program)) return true;
  const name = scriptName(program);
  if (name !== undefined && !walked.scripts.includes(name)) {
    const body = context.scripts.get(name);
    if (body !== undefined && scriptReleases(body, "", context, { ...walked, scripts: [...walked.scripts, name] }, byPath, walkedWorkflows)) return true;
  }
  for (const file of fileCandidates(program, dir)) {
    if (walked.files.includes(file)) continue;
    const body = context.files.get(file);
    if (body !== undefined && scriptReleases(body, dir, context, { ...walked, files: [...walked.files, file] }, byPath, walkedWorkflows)) return true;
  }
  return false;
}

function runSteps(workflow: Workflow): readonly { readonly script: string; readonly dir: string | undefined }[] {
  const dir = defaultDirectory(workflow.document, "");
  return workflowJobs(workflow).flatMap(([, job]) => {
    const jobDir = defaultDirectory(job, dir);
    const steps = Array.isArray(job["steps"]) ? job["steps"] : [];
    return steps.flatMap((step: unknown) =>
      isRecord(step) && typeof step["run"] === "string" ? [{ script: step["run"], dir: stepDirectory(step["working-directory"], jobDir) }] : [],
    );
  });
}

function localUses(job: Readonly<Record<string, unknown>>): string | undefined {
  const uses = job["uses"];
  return typeof uses === "string" && uses.startsWith("./") ? uses.slice(2) : undefined;
}

function workflowReleases(
  workflow: Workflow,
  context: ScheduleContext,
  byPath: ReadonlyMap<string, Workflow>,
  walkedWorkflows: readonly string[],
): boolean {
  if (documentPublishes(workflow.document)) return true;
  if (runSteps(workflow).some(({ script, dir }) => scriptReleases(script, dir, context, { scripts: [], files: [] }, byPath, walkedWorkflows))) return true;
  return workflowJobs(workflow).some(([, job]) => {
    const called = localUses(job);
    if (called === undefined || walkedWorkflows.includes(called)) return false;
    const next = byPath.get(called);
    return next !== undefined && workflowReleases(next, context, byPath, [...walkedWorkflows, called]);
  });
}

function schedules(document: unknown): boolean {
  const on = isRecord(document) ? document["on"] : undefined;
  return isRecord(on) ? "schedule" in on : (names(on) ?? []).includes("schedule");
}

export function findScheduledReleases(workflows: readonly Workflow[], context: ScheduleContext = EMPTY): readonly ScheduledRelease[] {
  const byPath = new Map(workflows.map((workflow) => [workflow.path, workflow] as const));
  return workflows
    .filter((workflow) => schedules(workflow.document) && workflowReleases(workflow, context, byPath, [workflow.path]))
    .map((workflow) => ({ location: locate(workflow.path, workflow.text.split("\n"))(["on"], "schedule", "on schedule") }));
}

export function formatScheduleReport(scheduled: readonly ScheduledRelease[]): string {
  return [
    `ci-wiring: ${scheduled.length} workflow(s) release on a schedule:`,
    ...scheduled.map(({ location }) => `  ${location}: drop the schedule, so a release runs only when someone starts it`),
  ].join("\n");
}
