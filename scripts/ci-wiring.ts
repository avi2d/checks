#!/usr/bin/env bun
import { Console, Effect, FileSystem, Path, Schema } from "effect";
import { git } from "./git.ts";
import { runMain } from "./main.ts";
import { DEFAULT_BRANCH, ENTRY_POINT, EVERY_REPOSITORY, KIT_GATES, QUALITY_FILE, selectedGates, type KitGate } from "./gates.ts";
import { readQuality, type Quality } from "./quality-file.ts";

export type Command = readonly string[];

export type Gate = {
  readonly command: string;
  readonly words: Command;
};

export type Declaration = {
  readonly gates: readonly Gate[];
  readonly scheduled: readonly Gate[];
  readonly defaultBranch: string;
  readonly lintGates: readonly KitGate[];
};

export type Workflow = {
  readonly path: string;
  readonly document: unknown;
};

export type BlockedInvocation = {
  readonly location: string;
  readonly blocker: string;
};

export type Omission = {
  readonly gate: string;
  readonly content: string;
  readonly files: readonly [string, ...string[]];
};

export type Gap = {
  readonly gate: string;
  readonly entryPoint?: string;
  readonly blocked: readonly BlockedInvocation[];
};

type RunStep = {
  readonly location: string;
  readonly blocker: string | undefined;
  readonly script: string;
};

type Trigger = (workflow: Workflow) => string | undefined;

export class WiringError extends Schema.TaggedError<WiringError>()("WiringError", {
  message: Schema.String,
}) {}

const WORKFLOWS = ".github/workflows";
// Without these a pull_request workflow never sees the commits a pull request pushes.
const GATING_TYPES = ["opened", "synchronize"];
const CONSTANTS = new Map([
  ["true", true],
  ["false", false],
]);
const STATUS_OVERRIDE = /\b(?:always|failure|cancelled)\s*\(/;
const VARIABLE = /^\$(?:[A-Za-z_][A-Za-z0-9_]*|\{[A-Za-z_][A-Za-z0-9_]*\})/;
const UNPLAIN = new Set(["|", "&", ";", "<", ">", "(", ")", "`", "\\", "#", "\n"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function names(value: unknown): readonly string[] | undefined {
  if (typeof value === "string") return [value];
  if (!Array.isArray(value)) return undefined;
  return value.filter((entry): entry is string => typeof entry === "string");
}

function expansion(text: string, from: number): number | undefined {
  const match = VARIABLE.exec(text.slice(from));
  return match === null ? undefined : from + match[0].length;
}

// A script counts only when it is one line of plain words: any shell control, redirection or
// substitution can run the gate without its failure failing the step.
function plainCommand(script: string): Command | undefined {
  const line = script.trim();
  const words: string[] = [];
  let word: string | undefined;
  for (let index = 0; index < line.length; index += 1) {
    const char = line.charAt(index);
    if (char === " " || char === "\t") {
      if (word !== undefined) words.push(word);
      word = undefined;
    } else if (char === "'") {
      const close = line.indexOf("'", index + 1);
      if (close === -1) return undefined;
      word = (word ?? "") + line.slice(index + 1, close);
      index = close;
    } else if (char === '"') {
      let quoted = "";
      for (index += 1; line.charAt(index) !== '"'; index += 1) {
        const inner = line.charAt(index);
        if (inner === "" || inner === "\\" || inner === "`") return undefined;
        if (inner === "$") {
          const end = expansion(line, index);
          if (end === undefined) return undefined;
          quoted += line.slice(index, end);
          index = end - 1;
        } else {
          quoted += inner;
        }
      }
      word = (word ?? "") + quoted;
    } else if (char === "$") {
      const end = expansion(line, index);
      if (end === undefined) return undefined;
      word = (word ?? "") + line.slice(index, end);
      index = end - 1;
    } else if (UNPLAIN.has(char)) {
      return undefined;
    } else {
      word = (word ?? "") + char;
    }
  }
  if (word !== undefined) words.push(word);
  return words.length === 0 ? undefined : words;
}

function invokes(command: Command | undefined, gate: Command): boolean {
  return command !== undefined && gate.length <= command.length && gate.every((word, index) => command[index] === word);
}

function mentions(script: string, gate: Command): boolean {
  const tokens = script.split(/[\s|&;<>()`]+/);
  return tokens.some((_, start) => invokes(tokens.slice(start), gate));
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

const pullRequestTrigger = (branch: string): Trigger => (workflow) => {
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
  if (filters["paths"] !== undefined || filters["paths-ignore"] !== undefined) {
    return `${workflow.path} filters pull_request by paths, so some pull requests skip the gate`;
  }
  const types = names(filters["types"]);
  const missing = types === undefined ? [] : GATING_TYPES.filter((type) => !types.includes(type));
  if (missing.length > 0) return `${workflow.path} limits pull_request to types without ${missing.join(", ")}`;
  return undefined;
};

const scheduleTrigger: Trigger = (workflow) => {
  const on = isRecord(workflow.document) ? workflow.document["on"] : undefined;
  const schedule = isRecord(on) ? on["schedule"] : undefined;
  const crons = Array.isArray(schedule) ? schedule.filter((entry) => isRecord(entry) && typeof entry["cron"] === "string") : [];
  return crons.length > 0 ? undefined : `${workflow.path} does not trigger on a schedule`;
};

// GitHub prefixes any other if: with success(), so only a status function overrides a needed job's skip.
function skippedBy(jobs: Readonly<Record<string, unknown>>, id: string, seen: readonly string[]): string | undefined {
  const job = jobs[id];
  if (!isRecord(job) || seen.includes(id)) return undefined;
  if (constant(job["if"]) === false) return `job ${id} sets if: false`;
  if (typeof job["if"] === "string" && STATUS_OVERRIDE.test(job["if"])) return undefined;
  for (const need of names(job["needs"]) ?? []) {
    const cause = skippedBy(jobs, need, [...seen, id]);
    if (cause !== undefined) return cause;
  }
  return undefined;
}

function localCall(uses: unknown): string | undefined {
  return typeof uses === "string" && uses.startsWith("./") ? uses.slice(2) : undefined;
}

function runSteps(workflows: readonly Workflow[], trigger: Trigger): readonly RunStep[] {
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
      const skipped = skippedBy(jobs, id, []);
      const jobBlocker =
        blocker ??
        switchedOff(job, `job ${id}`) ??
        (skipped === undefined ? undefined : `job ${id} needs a job that never runs: ${skipped}`);
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
          script: step["run"],
        });
      });
    }
  };

  for (const workflow of workflows) {
    visit(workflow.document, workflow.path, trigger(workflow), [workflow.path]);
  }
  return steps;
}

function entryPointCommand(gate: Command, lintGates: readonly KitGate[]): Command | undefined {
  const index = gate.findIndex((word) => lintGates.some((kitGate) => kitGate.bin === word));
  return index === -1 ? undefined : [...gate.slice(0, index), ENTRY_POINT.bin];
}

function gapsAmong(gates: readonly Gate[], steps: readonly RunStep[], lintGates: readonly KitGate[]): readonly Gap[] {
  return gates.flatMap((gate) => {
    const entryPoint = entryPointCommand(gate.words, lintGates);
    const commands = [
      { command: gate.command, words: gate.words },
      ...(entryPoint === undefined ? [] : [{ command: entryPoint.join(" "), words: entryPoint }]),
    ];
    const invoking = steps.flatMap(({ location, blocker, script }) => {
      const plain = plainCommand(script);
      if (commands.some(({ words }) => invokes(plain, words))) return [{ location, blocker }];
      const mentioned = commands.find(({ words }) => mentions(script, words));
      if (mentioned === undefined) return [];
      const alone = `the step runs more than ${mentioned.command}; give it its own step with nothing else in it`;
      return [{ location, blocker: blocker ?? alone }];
    });
    if (invoking.some((step) => step.blocker === undefined)) return [];
    const blocked = invoking.flatMap(({ location, blocker }) =>
      blocker === undefined ? [] : [{ location, blocker }],
    );
    return [{ gate: gate.command, entryPoint: entryPoint?.join(" "), blocked }];
  });
}

export function findGaps(declaration: Declaration, workflows: readonly Workflow[]): readonly Gap[] {
  return gapsAmong(declaration.gates, runSteps(workflows, pullRequestTrigger(declaration.defaultBranch)), declaration.lintGates);
}

export function findScheduledGaps(declaration: Declaration, workflows: readonly Workflow[]): readonly Gap[] {
  return gapsAmong(declaration.scheduled, runSteps(workflows, scheduleTrigger), declaration.lintGates);
}

function gapLines(gaps: readonly Gap[]): readonly string[] {
  const lines: string[] = [];
  for (const gap of gaps) {
    lines.push(`  ${gap.gate}`);
    if (gap.blocked.length === 0) {
      lines.push(gap.entryPoint === undefined ? "    no run step invokes it" : `    no run step invokes it or ${gap.entryPoint}`);
    }
    for (const { location, blocker } of gap.blocked) lines.push(`    ${location}: ${blocker}`);
  }
  return lines;
}

export function formatReport(declaration: Declaration, gaps: readonly Gap[]): string {
  const target = `pull requests to ${declaration.defaultBranch}`;
  if (gaps.length === 0) return `ci-wiring: ${declaration.gates.length} gate(s) run on ${target}`;
  return [`ci-wiring: ${gaps.length} of ${declaration.gates.length} gate(s) do not run on ${target}:`, ...gapLines(gaps)].join("\n");
}

export function formatScheduledReport(declaration: Declaration, gaps: readonly Gap[]): string {
  const total = declaration.scheduled.length;
  if (gaps.length === 0) return `ci-wiring: ${total} scheduled command(s) run on a schedule`;
  return [`ci-wiring: ${gaps.length} of ${total} scheduled command(s) do not run on a schedule:`, ...gapLines(gaps)].join("\n");
}

const plainCommands = Effect.fnUntraced(function* (
  listed: readonly string[],
  subject: string,
): Effect.fn.Return<readonly Gate[], WiringError> {
  const gates: Gate[] = [];
  for (const command of listed) {
    const words = plainCommand(command);
    if (words === undefined) {
      return yield* new WiringError({ message: `${subject} ${JSON.stringify(command)} is not one plain command` });
    }
    gates.push({ command, words });
  }
  return gates;
});

export const parseDeclaration = Effect.fnUntraced(function* (
  { defaultBranch, gates: declared }: Quality,
  source: string,
): Effect.fn.Return<Declaration, WiringError> {
  if (declared?.ci === undefined) {
    return yield* new WiringError({ message: `${QUALITY_FILE} declares no gates.ci, a non-empty array of commands` });
  }
  return {
    gates: yield* plainCommands(declared.ci, `${source} gate`),
    scheduled: yield* plainCommands(declared.scheduled ?? [], `${source} scheduled command`),
    defaultBranch: defaultBranch ?? DEFAULT_BRANCH,
    lintGates: selectedGates(declared.lint),
  };
});

function omittedFrom(lintGates: readonly KitGate[]): readonly KitGate[] {
  return KIT_GATES.filter((gate) => !lintGates.includes(gate));
}

export const findOmissions = Effect.fn("findOmissions")(function* (root: string, lintGates: readonly KitGate[]) {
  const omissions: Omission[] = [];
  for (const gate of omittedFrom(lintGates)) {
    // LintGates refuses a selection that leaves out a gate every repository runs.
    if (gate.appliesTo === EVERY_REPOSITORY) continue;
    const { pathspecs, content } = gate.appliesTo;
    const [first, ...rest] = (yield* git(["ls-files", "-z", "--", ...pathspecs], root)).split("\0").filter(Boolean);
    if (first !== undefined) omissions.push({ gate: gate.bin, content, files: [first, ...rest] });
  }
  return omissions;
});

function sample([first, ...rest]: Omission["files"]): string {
  return rest.length === 0 ? first : `${first} and ${rest.length} more`;
}

export function formatOmissions(lintGates: readonly KitGate[], omissions: readonly Omission[]): string | undefined {
  const omitted = omittedFrom(lintGates);
  if (omitted.length === 0) return undefined;
  if (omissions.length === 0) {
    const bins = omitted.map((gate) => gate.bin).join(", ");
    return `ci-wiring: ${QUALITY_FILE} gates.lint leaves out ${bins}, none of which this repository's contents make applicable`;
  }
  return [
    `ci-wiring: ${QUALITY_FILE} gates.lint leaves out ${omissions.length} gate(s) this repository's contents make applicable:`,
    ...omissions.map(({ gate, content, files }) => `  ${gate}: the repository tracks ${content} (${sample(files)})`),
  ].join("\n");
}

export const parseWorkflow = (path: string, text: string): Effect.Effect<Workflow, WiringError> =>
  Effect.try({
    try: () => ({ path, document: Bun.YAML.parse(text) }),
    catch: (error) => new WiringError({ message: `cannot parse ${path}: ${String(error)}` }),
  });

export const readDeclaration = Effect.fn("readDeclaration")(function* (root: string) {
  const { source, quality } = yield* readQuality(root);
  return yield* parseDeclaration(quality, source);
});

export const readWorkflows = Effect.fn("readWorkflows")(function* (root: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const directory = path.join(root, WORKFLOWS);
  if (!(yield* fs.exists(directory))) return [];
  const files = (yield* fs.readDirectory(directory))
    .filter((name) => name.endsWith(".yml") || name.endsWith(".yaml"))
    .sort();
  return yield* Effect.forEach(files, (name) =>
    fs
      .readFileString(path.join(directory, name))
      .pipe(Effect.flatMap((text) => parseWorkflow(`${WORKFLOWS}/${name}`, text))),
  );
});

const wiring = Effect.gen(function* () {
  const root = (yield* git(["rev-parse", "--show-toplevel"])).trim();
  const declaration = yield* readDeclaration(root);
  const workflows = yield* readWorkflows(root);
  const gaps = findGaps(declaration, workflows);
  const omissions = yield* findOmissions(root, declaration.lintGates);
  const gapReport = formatReport(declaration, gaps);
  yield* gaps.length > 0 ? Console.error(gapReport) : Console.log(gapReport);
  const omissionReport = formatOmissions(declaration.lintGates, omissions);
  if (omissionReport !== undefined) {
    yield* omissions.length > 0 ? Console.error(omissionReport) : Console.log(omissionReport);
  }
  if (declaration.scheduled.length === 0) return gaps.length === 0 && omissions.length === 0;
  const scheduledGaps = findScheduledGaps(declaration, workflows);
  const scheduledReport = formatScheduledReport(declaration, scheduledGaps);
  yield* scheduledGaps.length > 0 ? Console.error(scheduledReport) : Console.log(scheduledReport);
  return gaps.length === 0 && omissions.length === 0 && scheduledGaps.length === 0;
});

if (import.meta.main) runMain("ci-wiring", wiring);
