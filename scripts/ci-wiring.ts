#!/usr/bin/env bun
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type Command = readonly string[];

export type Gate = {
  readonly command: string;
  readonly words: Command;
};

export type Declaration = {
  readonly gates: readonly Gate[];
  readonly defaultBranch: string;
};

export type Workflow = {
  readonly path: string;
  readonly document: unknown;
};

export type BlockedInvocation = {
  readonly location: string;
  readonly blocker: string;
};

export type Gap = {
  readonly gate: string;
  readonly blocked: readonly BlockedInvocation[];
};

type RunStep = {
  readonly location: string;
  readonly blocker: string | undefined;
  readonly commands: readonly Command[];
};

export class WiringError extends Error {}

const WORKFLOWS = ".github/workflows";
const DEFAULT_BRANCH = "main";
// Without these a pull_request workflow never sees the commits a pull request pushes.
const GATING_TYPES = ["opened", "synchronize"];
const CONSTANTS = new Map([
  ["true", true],
  ["false", false],
]);
const SEPARATORS = new Set([";", "&", "|", "\n", "(", ")"]);
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function names(value: unknown): readonly string[] | undefined {
  if (typeof value === "string") return [value];
  if (!Array.isArray(value)) return undefined;
  return value.filter((entry): entry is string => typeof entry === "string");
}

export function commands(script: string): readonly Command[] {
  const found: Command[] = [];
  let words: string[] = [];
  let word: string | undefined;
  const endWord = (): void => {
    if (word !== undefined) words.push(word);
    word = undefined;
  };
  const endCommand = (): void => {
    endWord();
    const start = words.findIndex((entry) => !ASSIGNMENT.test(entry));
    if (start !== -1) found.push(words.slice(start));
    words = [];
  };

  for (let index = 0; index < script.length; index += 1) {
    const char = script.charAt(index);
    if (char === "\\") {
      index += 1;
      if (index < script.length && script.charAt(index) !== "\n") word = (word ?? "") + script.charAt(index);
    } else if (char === "'") {
      const close = script.indexOf("'", index + 1);
      const end = close === -1 ? script.length : close;
      word = (word ?? "") + script.slice(index + 1, end);
      index = end;
    } else if (char === '"') {
      let quoted = "";
      for (index += 1; index < script.length && script.charAt(index) !== '"'; index += 1) {
        const escaped = script.charAt(index + 1);
        if (script.charAt(index) === "\\" && escaped !== "" && '"\\$`\n'.includes(escaped)) {
          index += 1;
          if (escaped !== "\n") quoted += escaped;
        } else {
          quoted += script.charAt(index);
        }
      }
      word = (word ?? "") + quoted;
    } else if (char === "#" && word === undefined) {
      const newline = script.indexOf("\n", index);
      index = newline === -1 ? script.length : newline - 1;
    } else if (char === " " || char === "\t") {
      endWord();
    } else if (SEPARATORS.has(char)) {
      endCommand();
    } else {
      word = (word ?? "") + char;
    }
  }
  endCommand();
  return found;
}

function invokes(command: Command, gate: Command): boolean {
  return gate.length <= command.length && gate.every((word, index) => command[index] === word);
}

function constant(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return undefined;
  const expression = value.trim().replace(/^\$\{\{(.*)\}\}$/s, "$1").trim();
  return CONSTANTS.get(expression);
}

function switchedOff(node: Readonly<Record<string, unknown>>, subject: string): string | undefined {
  if (constant(node["if"]) === false) return `${subject} sets if: false`;
  if (constant(node["continue-on-error"]) === true) return `${subject} sets continue-on-error: true`;
  return undefined;
}

// Last match wins, as GitHub evaluates a branch filter, so one match anywhere is not enough.
function selects(patterns: readonly string[], branch: string): boolean {
  let selected = false;
  for (const pattern of patterns) {
    const excludes = pattern.startsWith("!");
    if (new Bun.Glob(excludes ? pattern.slice(1) : pattern).match(branch)) selected = !excludes;
  }
  return selected;
}

function triggerBlocker(workflow: Workflow, branch: string): string | undefined {
  const on = isRecord(workflow.document) ? workflow.document["on"] : undefined;
  const events = isRecord(on) ? Object.keys(on) : (names(on) ?? []);
  if (!events.includes("pull_request")) return `${workflow.path} does not trigger on pull_request`;

  const filters = isRecord(on) ? on["pull_request"] : undefined;
  if (!isRecord(filters)) return undefined;
  const branches = names(filters["branches"]);
  if (branches !== undefined && !selects(branches, branch)) {
    return `${workflow.path} limits pull_request to branches other than ${branch}`;
  }
  const ignored = names(filters["branches-ignore"]);
  if (ignored?.some((pattern) => new Bun.Glob(pattern).match(branch)) === true) {
    return `${workflow.path} ignores pull_request to ${branch}`;
  }
  const types = names(filters["types"]);
  const missing = types === undefined ? [] : GATING_TYPES.filter((type) => !types.includes(type));
  if (missing.length > 0) return `${workflow.path} limits pull_request to types without ${missing.join(", ")}`;
  return undefined;
}

function localCall(uses: unknown): string | undefined {
  return typeof uses === "string" && uses.startsWith("./") ? uses.slice(2) : undefined;
}

function runSteps(workflows: readonly Workflow[], branch: string): readonly RunStep[] {
  const documents = new Map(workflows.map((workflow) => [workflow.path, workflow.document]));
  const steps: RunStep[] = [];

  const visit = (
    document: unknown,
    location: string,
    blocker: string | undefined,
    walked: readonly string[],
  ): void => {
    const jobs = isRecord(document) ? document["jobs"] : undefined;
    if (!isRecord(jobs)) return;
    for (const [id, job] of Object.entries(jobs)) {
      if (!isRecord(job)) continue;
      const jobLocation = `${location} job ${id}`;
      const jobBlocker = blocker ?? switchedOff(job, `job ${id}`);
      const called = localCall(job["uses"]);
      if (called !== undefined && !walked.includes(called)) {
        visit(documents.get(called), `${jobLocation} > ${called}`, jobBlocker, [...walked, called]);
      }
      const jobSteps = job["steps"];
      if (!Array.isArray(jobSteps)) continue;
      jobSteps.forEach((step: unknown, index) => {
        if (!isRecord(step) || typeof step["run"] !== "string") return;
        steps.push({
          location: `${jobLocation} step ${index + 1}`,
          blocker: jobBlocker ?? switchedOff(step, "the step"),
          commands: commands(step["run"]),
        });
      });
    }
  };

  for (const workflow of workflows) {
    visit(workflow.document, workflow.path, triggerBlocker(workflow, branch), [workflow.path]);
  }
  return steps;
}

export function findGaps(declaration: Declaration, workflows: readonly Workflow[]): readonly Gap[] {
  const steps = runSteps(workflows, declaration.defaultBranch);
  return declaration.gates.flatMap((gate) => {
    const invoking = steps.filter((step) => step.commands.some((command) => invokes(command, gate.words)));
    if (invoking.some((step) => step.blocker === undefined)) return [];
    const blocked = invoking.flatMap(({ location, blocker }) =>
      blocker === undefined ? [] : [{ location, blocker }],
    );
    return [{ gate: gate.command, blocked }];
  });
}

export function formatReport(declaration: Declaration, gaps: readonly Gap[]): string {
  const target = `pull requests to ${declaration.defaultBranch}`;
  if (gaps.length === 0) return `ci-wiring: ${declaration.gates.length} gate(s) run on ${target}`;
  const lines = [`ci-wiring: ${gaps.length} of ${declaration.gates.length} gate(s) do not run on ${target}:`];
  for (const gap of gaps) {
    lines.push(`  ${gap.gate}`);
    if (gap.blocked.length === 0) lines.push("    no run step invokes it");
    for (const { location, blocker } of gap.blocked) lines.push(`    ${location}: ${blocker}`);
  }
  return lines.join("\n");
}

export function parseDeclaration(manifest: unknown, source: string): Declaration {
  const configured = isRecord(manifest) && isRecord(manifest["ciWiring"]) ? manifest["ciWiring"] : {};
  const listed = configured["gates"];
  if (!Array.isArray(listed) || listed.length === 0) {
    throw new WiringError(`ci-wiring: ${source} sets no ciWiring.gates, a non-empty array of commands`);
  }
  const gates = listed.map((command: unknown): Gate => {
    const [words, ...rest] = typeof command === "string" ? commands(command) : [];
    if (typeof command !== "string" || words === undefined || rest.length > 0) {
      throw new WiringError(`ci-wiring: ${source} ciWiring gate ${JSON.stringify(command)} is not one command`);
    }
    return { command, words };
  });
  const defaultBranch = configured["defaultBranch"] ?? DEFAULT_BRANCH;
  if (typeof defaultBranch !== "string" || defaultBranch === "") {
    throw new WiringError(`ci-wiring: ${source} ciWiring.defaultBranch is not a branch name`);
  }
  return { gates, defaultBranch };
}

export function parseWorkflow(path: string, text: string): Workflow {
  try {
    return { path, document: Bun.YAML.parse(text) };
  } catch (error) {
    throw new WiringError(`ci-wiring: cannot parse ${path}: ${String(error)}`);
  }
}

export function readDeclaration(root: string): Declaration {
  const path = join(root, "package.json");
  let manifest: unknown;
  try {
    manifest = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new WiringError(`ci-wiring: cannot read ${path} as JSON`);
  }
  return parseDeclaration(manifest, path);
}

export function readWorkflows(root: string): readonly Workflow[] {
  const directory = join(root, WORKFLOWS);
  if (!existsSync(directory)) return [];
  return readdirSync(directory)
    .filter((name) => name.endsWith(".yml") || name.endsWith(".yaml"))
    .sort()
    .map((name) => parseWorkflow(`${WORKFLOWS}/${name}`, readFileSync(join(directory, name), "utf8")));
}

function repositoryRoot(): string {
  const result = Bun.spawnSync(["git", "rev-parse", "--show-toplevel"], { stdout: "pipe", stderr: "pipe" });
  if (!result.success) {
    throw new WiringError(`ci-wiring: git rev-parse --show-toplevel: ${result.stderr.toString().trim()}`);
  }
  return result.stdout.toString().trim();
}

if (import.meta.main) {
  try {
    const root = repositoryRoot();
    const declaration = readDeclaration(root);
    const gaps = findGaps(declaration, readWorkflows(root));
    if (gaps.length > 0) {
      console.error(formatReport(declaration, gaps));
      process.exit(1);
    }
    console.log(formatReport(declaration, gaps));
  } catch (error) {
    console.error(error instanceof WiringError ? error.message : `ci-wiring: ${String(error)}`);
    process.exit(2);
  }
}
