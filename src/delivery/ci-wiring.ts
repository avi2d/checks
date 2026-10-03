#!/usr/bin/env bun
import { Config, Console, Effect, FileSystem, Path, Schema } from "effect";
import { defaultBranch, git } from "../core/git.ts";
import { runMain } from "../core/main.ts";
import { ENTRY_POINT, KIT_GATES, type KitGate } from "../core/gates.ts";
import { invokes, mentions, plainCommand, shellCommands, type Command } from "./shell-command.ts";

export type { Command };

export type Gate = {
  readonly command: string;
  readonly words: Command;
};

export type Declaration = {
  readonly gates: readonly Gate[];
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

export type Gap = {
  readonly gate: string;
  readonly entryPoint?: string;
  readonly blocked: readonly BlockedInvocation[];
};

export type Visibility = "private" | "public" | "unknown";

export type RunnerPolicy = {
  readonly visibility: Visibility;
  readonly scripts: ReadonlyMap<string, string>;
};

export type RunnerFault = {
  readonly location: string;
  readonly fault: string;
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
const SCRIPTED = ["lint", "build", "typecheck", "test"];
const BUILT_TREE = "git diff --exit-code";
const TITLE_LINT = "./node_modules/.bin/commitlint";
const Manifest = Schema.Struct({ scripts: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)) });
// Without these a pull_request workflow never sees the commits a pull request pushes.
const GATING_TYPES = ["opened", "synchronize"];
const CONSTANTS = new Map([
  ["true", true],
  ["false", false],
]);
const STATUS_OVERRIDE = /\b(?:always|failure|cancelled)\s*\(/;
const RUNNER_OVERRIDE = "vars.CI_RUNS_ON";
const MUTATION_RUNNER = ["self-hosted", "Linux", "X64", "winbox"];
const HOSTED_DEFAULT = "${{ vars.CI_RUNS_ON || 'ubuntu-latest' }}";
const MUTATION_BINS = ["checks-mutation", "checks-mutation-compare"];
const EventRepository = Schema.fromJsonString(Schema.Struct({ repository: Schema.Struct({ private: Schema.Boolean }) }));

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function names(value: unknown): readonly string[] | undefined {
  if (typeof value === "string") return [value];
  if (!Array.isArray(value)) return undefined;
  return value.filter((entry): entry is string => typeof entry === "string");
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
    return [{ gate: gate.command, ...(entryPoint === undefined ? {} : { entryPoint: entryPoint.join(" ") }), blocked }];
  });
}

export function findGaps(declaration: Declaration, workflows: readonly Workflow[]): readonly Gap[] {
  return gapsAmong(declaration.gates, runSteps(workflows, pullRequestTrigger(declaration.defaultBranch)), declaration.lintGates);
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

export function requiredCommands(scripts: readonly string[]): readonly string[] {
  return [
    ...SCRIPTED.filter((name) => scripts.includes(name)).flatMap((name) =>
      name === "build" ? [`bun run ${name}`, BUILT_TREE] : [`bun run ${name}`],
    ),
    TITLE_LINT,
  ];
}

export function declarationFor(scripts: readonly string[], branch: string): Declaration {
  return {
    gates: requiredCommands(scripts).map((command) => ({ command, words: command.split(" ") })),
    defaultBranch: branch,
    lintGates: KIT_GATES,
  };
}

function runsMutation(script: string, scripts: ReadonlyMap<string, string>, walked: readonly string[] = []): boolean {
  return shellCommands(script).some((words) =>
    words.some((word, index) => {
      const bin = word.slice(word.lastIndexOf("/") + 1);
      if (MUTATION_BINS.includes(bin)) return true;
      if (bin === "stryker") return words[index + 1] === "run";
      const name = word === "run" && words[index - 1] === "bun" ? words[index + 1] : undefined;
      const body = name === undefined || walked.includes(name) ? undefined : scripts.get(name);
      return body !== undefined && name !== undefined && runsMutation(body, scripts, [...walked, name]);
    }),
  );
}

function sameLabels(runsOn: unknown, labels: readonly string[]): boolean {
  const named = Array.isArray(runsOn) ? names(runsOn) : undefined;
  return named?.length === labels.length && labels.every((label) => named.includes(label));
}

const unspaced = (expression: string): string => expression.replace(/\s+/g, "");

function runnerFault(runsOn: unknown, mutation: boolean, visibility: Visibility): string | undefined {
  const readsOverride = JSON.stringify(runsOn).includes(RUNNER_OVERRIDE);
  const pin = `set runs-on: [${MUTATION_RUNNER.join(", ")}]`;
  if (mutation && readsOverride) return `a mutation job reads CI_RUNS_ON, so an override moves its full sweeps off winbox; ${pin}`;
  if (mutation) return visibility === "private" && !sameLabels(runsOn, MUTATION_RUNNER) ? `a mutation job in a private repository runs off winbox; ${pin}` : undefined;
  const hosted = typeof runsOn === "string" && unspaced(runsOn) === unspaced(HOSTED_DEFAULT);
  if (hosted || (visibility !== "private" && !readsOverride)) return undefined;
  return `the job is not on a hosted runner CI_RUNS_ON can override; set runs-on: ${HOSTED_DEFAULT}`;
}

export function findRunnerFaults(policy: RunnerPolicy, workflows: readonly Workflow[]): readonly RunnerFault[] {
  return workflows.flatMap((workflow) => {
    const jobs = isRecord(workflow.document) ? workflow.document["jobs"] : undefined;
    if (!isRecord(jobs)) return [];
    return Object.entries(jobs).flatMap(([id, job]) => {
      if (!isRecord(job) || job["runs-on"] === undefined) return [];
      const steps = Array.isArray(job["steps"]) ? job["steps"] : [];
      const mutation = steps.some((step: unknown) => isRecord(step) && typeof step["run"] === "string" && runsMutation(step["run"], policy.scripts));
      const fault = runnerFault(job["runs-on"], mutation, policy.visibility);
      return fault === undefined ? [] : [{ location: `${workflow.path} job ${id}`, fault }];
    });
  });
}

export function formatRunnerReport(faults: readonly RunnerFault[]): string {
  return [`ci-wiring: ${faults.length} job(s) run on the wrong runner:`, ...faults.map(({ location, fault }) => `  ${location}: ${fault}`)].join("\n");
}

export const parseWorkflow = (path: string, text: string): Effect.Effect<Workflow, WiringError> =>
  Effect.try({
    try: () => ({ path, document: Bun.YAML.parse(text) }),
    catch: (error) => new WiringError({ message: `cannot parse ${path}: ${String(error)}` }),
  });

const readScripts = Effect.fn("readScripts")(function* (root: string) {
  const fs = yield* FileSystem.FileSystem;
  const file = (yield* Path.Path).join(root, "package.json");
  const { scripts = {} } = (yield* fs.exists(file))
    ? yield* fs.readFileString(file).pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(Schema.fromJsonString(Manifest))),
        Effect.mapError((cause) => new WiringError({ message: `cannot read ${file}: ${cause.message}` })),
      )
    : Manifest.make({});
  return new Map(Object.entries(scripts));
});

export const readDeclaration = Effect.fn("readDeclaration")(function* (root: string) {
  return declarationFor([...(yield* readScripts(root)).keys()], yield* defaultBranch(root));
});

// Only GitHub's event says whether the repository is private, so a run outside CI judges what holds in either.
const readVisibility = Effect.gen(function* () {
  const eventPath = yield* Config.String("GITHUB_EVENT_PATH").pipe(Config.withDefault(""));
  if (eventPath === "") return "unknown" satisfies Visibility;
  return yield* (yield* FileSystem.FileSystem).readFileString(eventPath).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(EventRepository)),
    Effect.map(({ repository }): Visibility => (repository.private ? "private" : "public")),
    Effect.orElseSucceed((): Visibility => "unknown"),
  );
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
  const workflows = yield* readWorkflows(root);
  const declaration = yield* readDeclaration(root);
  const gaps = findGaps(declaration, workflows);
  const gapReport = formatReport(declaration, gaps);
  yield* gaps.length > 0 ? Console.error(gapReport) : Console.log(gapReport);
  const faults = findRunnerFaults({ visibility: yield* readVisibility, scripts: yield* readScripts(root) }, workflows);
  if (faults.length > 0) yield* Console.error(formatRunnerReport(faults));
  return gaps.length === 0 && faults.length === 0;
});

if (import.meta.main) runMain("ci-wiring", wiring);
