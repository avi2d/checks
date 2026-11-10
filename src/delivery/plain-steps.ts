#!/usr/bin/env bun
import { Effect, FileSystem, Path, Schema } from "effect";
import { workingTreeFiles } from "../core/git.ts";
import { runTreeGate } from "../core/main.ts";
import { baseNameOf, isNpxCall, resolvedUsesInlineCode } from "./inline-code.ts";
import { fromProgram, REDIRECT_OPERATOR, shellWords, substitutionEnd } from "./shell-command.ts";
import { isRecord, maskExpressions, scalarSource } from "./workflow-references.ts";

export type YamlFile = {
  readonly path: string;
  readonly document: unknown;
  readonly text: string;
};

export type StepFault = {
  readonly location: string;
  readonly faults: readonly string[];
};

export type StepContext =
  | { readonly kind: "workflow" }
  | { readonly kind: "reusable"; readonly inputDefaults: ReadonlyMap<string, string> }
  | { readonly kind: "composite"; readonly inputForEnv: ReadonlyMap<string, string>; readonly inputDefaults: ReadonlyMap<string, string> };

type RunStep = {
  readonly keys: readonly (string | number)[];
  readonly label: string;
  readonly run: string | undefined;
  readonly shell: unknown;
  readonly context: StepContext;
};

const NAME = "plain-steps";
const SWITCH = "checks.plainSteps";
const WORKFLOWS = ".github/workflows/";
const ACTION_FILES = new Set(["action.yml", "action.yaml"]);
const UNJUDGED_PREFIXES = ["node_modules/", "repos/", "tests/fixtures/"] as const;
const PLAIN_SHELLS = new Set(["bash", "sh", "pwsh", "powershell", "cmd"]);
const SIMPLE_EXPANSION = /^\$\{[A-Za-z_][A-Za-z0-9_]*\}/;
const INPUT_EXPRESSION = /^\$\{\{\s*inputs\.([A-Za-z_][A-Za-z0-9_-]*)\s*\}\}$/;
const VARIABLE = String.raw`\$(?:([A-Za-z_][A-Za-z0-9_]*)|\{([A-Za-z_][A-Za-z0-9_]*)\})`;
const PROGRAM_VARIABLE = new RegExp(String.raw`^(?:"${VARIABLE}"|${VARIABLE})(?=\s|$)`);
const ORDINARY: StepContext = { kind: "workflow" };
const CONTROL_OPERATORS: readonly (readonly [string, string])[] = [
  ["&&", "a command list"],
  ["||", "a command list"],
  [";", "a command list"],
  ["|", "a pipe"],
  ["&", "a background job"],
  ["(", "a subshell"],
  [")", "a subshell"],
];
const Manifest = Schema.Struct({
  checks: Schema.optional(Schema.Struct({ plainSteps: Schema.optional(Schema.Boolean) })),
});

class PlainStepsError extends Schema.TaggedError<PlainStepsError>()("PlainStepsError", {
  message: Schema.String,
}) {}

export function isJudged(file: string): boolean {
  if (UNJUDGED_PREFIXES.some((prefix) => file.startsWith(prefix))) return false;
  if (file.startsWith(WORKFLOWS)) return /^[^/]+\.ya?ml$/.test(file.slice(WORKFLOWS.length));
  return ACTION_FILES.has(baseNameOf(file));
}

function singleQuotedEnd(line: string, open: number, found: Set<string>): number {
  const close = line.indexOf("'", open + 1);
  const end = close === -1 ? line.length : close;
  if (line.slice(open + 1, end).includes("\\")) found.add("a backslash escape");
  return end + 1;
}

function dollarEnd(line: string, index: number, found: Set<string>): number {
  const next = line.charAt(index + 1);
  if (next === "(") {
    found.add("a command substitution");
    return Math.min(substitutionEnd(line, index) + 1, line.length);
  }
  if (next !== "{") return index + 1;
  const simple = SIMPLE_EXPANSION.exec(line.slice(index));
  if (simple !== null) return index + simple[0].length;
  found.add("a parameter expansion");
  return index + 2;
}

function doubleQuotedEnd(line: string, open: number, found: Set<string>): number {
  let index = open + 1;
  while (index < line.length && line.charAt(index) !== '"') {
    const char = line.charAt(index);
    if (char === "\\") {
      found.add("a backslash escape");
      index += 2;
    } else if (char === "`") {
      found.add("a command substitution");
      index += 1;
    } else {
      index = char === "$" ? dollarEnd(line, index, found) : index + 1;
    }
  }
  return index + 1;
}

function operatorEnd(line: string, index: number, found: Set<string>): number | undefined {
  if (line.startsWith("<<", index)) {
    found.add("a here-document");
    return index + 2;
  }
  if (line.startsWith("&>", index)) {
    found.add("a redirect");
    return index + 2;
  }
  const redirect = REDIRECT_OPERATOR.exec(line.slice(index));
  if (redirect !== null) {
    found.add("a redirect");
    return index + redirect[0].length;
  }
  const control = CONTROL_OPERATORS.find(([operator]) => line.startsWith(operator, index));
  if (control === undefined) return undefined;
  found.add(control[1]);
  return index + control[0].length;
}

function startsWord(line: string, index: number): boolean {
  return index === 0 || /\s/.test(line.charAt(index - 1));
}

function unquotedEnd(line: string, index: number, found: Set<string>): number {
  const char = line.charAt(index);
  if (char === "'") return singleQuotedEnd(line, index, found);
  if (char === '"') return doubleQuotedEnd(line, index, found);
  if (char === "$") return dollarEnd(line, index, found);
  if (char === "\\") {
    found.add("a backslash escape");
    return index + 2;
  }
  if (char === "`") {
    found.add("a command substitution");
    return index + 1;
  }
  if (char === "#" && startsWord(line, index)) {
    found.add("a shell comment");
    return line.length;
  }
  return operatorEnd(line, index, found) ?? index + 1;
}

export function shellConstructs(line: string): readonly string[] {
  const found = new Set<string>();
  let index = 0;
  while (index < line.length) index = unquotedEnd(line, index, found);
  return [...found];
}

const TIMEOUT_VALUE_OPTIONS = new Set(["-k", "--kill-after", "-s", "--signal"]);
const NICE_VALUE_OPTIONS = new Set(["-n", "--adjustment"]);
const XARGS_VALUE_OPTIONS = new Set(["-a", "--arg-file", "-d", "--delimiter", "-E", "-e", "--eof", "-I", "--replace", "-L", "--max-lines", "-n", "--max-args", "-P", "--max-procs", "-s", "--max-chars"]);
const DOCKER_VALUE_OPTIONS = new Set(["--add-host", "-c", "--cpu-shares", "--cpus", "--cap-add", "--cap-drop", "--cpuset-cpus", "--cpuset-mems", "--cidfile", "--detach-keys", "--device", "--dns", "--dns-option", "--dns-search", "--entrypoint", "-e", "--env", "--env-file", "--expose", "--group-add", "--gpus", "-h", "--hostname", "--health-cmd", "--health-interval", "--health-retries", "--health-start-period", "--health-timeout", "--ip", "--ipc", "-l", "--label", "--link", "--log-driver", "--log-opt", "--mac-address", "-m", "--memory", "--mount", "--name", "--network", "-p", "--publish", "--pid", "--pull", "--platform", "--restart", "--runtime", "--security-opt", "--shm-size", "--stop-signal", "--stop-timeout", "--storage-opt", "--sysctl", "--tmpfs", "-u", "--user", "--userns", "--ulimit", "-v", "--volume", "--volumes-from", "-w", "--workdir"]);

function afterOptions(words: readonly string[], from: number, values: ReadonlySet<string>): number {
  let index = from;
  while (index < words.length) {
    const word = words[index] ?? "";
    if (word === "--") return index + 1;
    if (!word.startsWith("-") || word === "-") return index;
    const base = word.split("=")[0] ?? "";
    index += values.has(base) && !word.includes("=") ? 2 : 1;
  }
  return index;
}

function timeoutHandoff(words: readonly string[]): readonly string[] | undefined {
  const start = afterOptions(words, 1, TIMEOUT_VALUE_OPTIONS) + 1;
  return start < words.length ? words.slice(start) : undefined;
}

function dockerHandoff(words: readonly string[]): readonly string[] | undefined {
  if ((words[1] ?? "").toLowerCase() !== "run") return undefined;
  const start = afterOptions(words, 2, DOCKER_VALUE_OPTIONS) + 1;
  return start < words.length ? words.slice(start) : undefined;
}

function findHandoffs(words: readonly string[]): readonly (readonly string[])[] {
  const found: (readonly string[])[] = [];
  for (let index = 0; index < words.length; index += 1) {
    if (words[index] === "-exec" || words[index] === "-execdir") {
      const sub = words.slice(index + 1);
      if (sub.length > 0) found.push(sub);
    }
  }
  return found;
}

function handoffs(words: readonly string[]): readonly (readonly string[])[] {
  const name = baseNameOf(words[0] ?? "").toLowerCase();
  if (name === "timeout") {
    const sub = timeoutHandoff(words);
    return sub === undefined ? [] : [sub];
  }
  if (name === "nice") {
    const start = afterOptions(words, 1, NICE_VALUE_OPTIONS);
    return start < words.length ? [words.slice(start)] : [];
  }
  if (name === "xargs") {
    const start = afterOptions(words, 1, XARGS_VALUE_OPTIONS);
    return start < words.length ? [words.slice(start)] : [];
  }
  if (name === "docker") {
    const sub = dockerHandoff(words);
    return sub === undefined ? [] : [sub];
  }
  if (name === "find") return findHandoffs(words);
  return [];
}

function checkSlice(slice: readonly string[]): boolean {
  if (isNpxCall(slice)) return true;
  const resolved = fromProgram(slice);
  if (resolvedUsesInlineCode(resolved)) return true;
  return followsHandoff(slice, resolved);
}

function followsHandoff(slice: readonly string[], resolved: readonly string[]): boolean {
  if (handoffs(slice).some((sub) => checkSlice(sub))) return true;
  return resolved !== slice && handoffs(resolved).some((sub) => checkSlice(sub));
}

export function runsInlineCode(words: readonly string[]): boolean {
  return checkSlice(words);
}

function shellFault(shell: unknown): string | undefined {
  if (shell === undefined) return undefined;
  if (typeof shell !== "string") return "a shell the check cannot read";
  if (shell.includes("${{")) return "a shell the check cannot read";
  const [program = ""] = shell.trim().split(/\s+/);
  return PLAIN_SHELLS.has(baseNameOf(program)) ? undefined : `inline code for the ${program} shell`;
}

function programVariable(line: string): string | undefined {
  const match = PROGRAM_VARIABLE.exec(line);
  return match === null ? undefined : match.slice(1).join("");
}

function inputName(value: string): string | undefined {
  const match = INPUT_EXPRESSION.exec(value);
  return match?.[1];
}

function stringDefaults(inputs: unknown): ReadonlyMap<string, string> {
  if (!isRecord(inputs)) return new Map();
  const defaults = new Map<string, string>();
  for (const [name, spec] of Object.entries(inputs)) {
    if (isRecord(spec) && typeof spec["default"] === "string" && spec["default"].trim() !== "") defaults.set(name, spec["default"]);
  }
  return defaults;
}

function reusableDefaults(document: Readonly<Record<string, unknown>>): ReadonlyMap<string, string> {
  const on = document["on"];
  if (!isRecord(on)) return new Map();
  const call = on["workflow_call"];
  if (!isRecord(call)) return new Map();
  return stringDefaults(call["inputs"]);
}

function compositeDefaults(document: Readonly<Record<string, unknown>>): ReadonlyMap<string, string> {
  return stringDefaults(document["inputs"]);
}

function envInputs(step: Readonly<Record<string, unknown>>): ReadonlyMap<string, string> {
  const env = step["env"];
  if (!isRecord(env)) return new Map();
  const found = new Map<string, string>();
  for (const [name, value] of Object.entries(env)) {
    if (typeof value !== "string") continue;
    const input = inputName(value);
    if (input !== undefined) found.set(name, input);
  }
  return found;
}

function runsCallerCommand(line: string, plain: string, context: StepContext): boolean {
  if (context.kind === "workflow") return false;
  if (inputName(line) !== undefined) return true;
  if (context.kind === "reusable") return false;
  const name = programVariable(plain);
  return name !== undefined && context.inputForEnv.has(name);
}

function callerDefault(line: string, plain: string, context: StepContext): { readonly name: string; readonly value: string } | undefined {
  if (context.kind === "workflow") return undefined;
  const direct = inputName(line);
  if (direct !== undefined) {
    const value = context.inputDefaults.get(direct);
    return value === undefined ? undefined : { name: direct, value };
  }
  if (context.kind === "reusable") return undefined;
  const name = programVariable(plain);
  if (name === undefined) return undefined;
  const input = context.inputForEnv.get(name);
  if (input === undefined) return undefined;
  const value = context.inputDefaults.get(input);
  return value === undefined ? undefined : { name: input, value };
}

export function runFaults(run: string, shell: unknown, context: StepContext = ORDINARY): readonly string[] {
  const line = run.trim();
  if (line === "") return ["no command"];
  const plain = maskExpressions(line);
  const faults = [...shellConstructs(plain)];
  if (line.includes("\n")) faults.push("more than one line");
  const [words = []] = shellWords(plain);
  const texts = words.map(({ text }) => text);
  if (runsInlineCode(texts)) faults.push("inline interpreter code");
  const caller = runsCallerCommand(line, plain, context);
  if (fromProgram(texts)[0]?.includes("$") === true && !caller) faults.push("a command named only at run time");
  if (caller) {
    const fallback = callerDefault(line, plain, context);
    if (fallback !== undefined) faults.push(...runFaults(fallback.value, shell, ORDINARY).map((fault) => `${fault} in the default of input ${fallback.name}`));
  }
  const fault = shellFault(shell);
  return fault === undefined ? faults : [...faults, fault];
}

function stepLabel(step: Readonly<Record<string, unknown>>, index: number): string {
  if (typeof step["name"] === "string") return `step "${step["name"]}"`;
  if (typeof step["id"] === "string") return `step ${step["id"]}`;
  return `step ${index + 1}`;
}

function defaultShell(node: unknown): unknown {
  const defaults = isRecord(node) ? node["defaults"] : undefined;
  const run = isRecord(defaults) ? defaults["run"] : undefined;
  return isRecord(run) ? run["shell"] : undefined;
}

function triggers(on: unknown): readonly unknown[] {
  if (Array.isArray(on)) return on;
  return isRecord(on) ? Object.keys(on) : [on];
}

function workflowContext(document: Readonly<Record<string, unknown>>): StepContext {
  const events = triggers(document["on"]);
  if (!(events.includes("workflow_call") && !events.includes("workflow_dispatch"))) return ORDINARY;
  return { kind: "reusable", inputDefaults: reusableDefaults(document) };
}

type ContextOf = (step: Readonly<Record<string, unknown>>) => StepContext;

function compositeContextFor(document: Readonly<Record<string, unknown>>): ContextOf {
  const defaults = compositeDefaults(document);
  return (step) => ({ kind: "composite", inputForEnv: envInputs(step), inputDefaults: defaults });
}

function runSteps(steps: unknown, keys: readonly (string | number)[], prefix: string, inherited: unknown, contextOf: ContextOf): readonly RunStep[] {
  if (!Array.isArray(steps)) return [];
  return steps.flatMap((step: unknown, index) => {
    if (!isRecord(step) || step["run"] === undefined) return [];
    return [{
      keys: [...keys, index, "run"],
      label: prefix + stepLabel(step, index),
      run: typeof step["run"] === "string" || typeof step["run"] === "number" ? `${step["run"]}` : undefined,
      shell: step["shell"] ?? inherited,
      context: contextOf(step),
    }];
  });
}

function stepsOf(file: YamlFile): readonly RunStep[] {
  const { document } = file;
  if (!isRecord(document)) return [];
  if (!file.path.startsWith(WORKFLOWS)) {
    const runs = document["runs"];
    return isRecord(runs) ? runSteps(runs["steps"], ["runs", "steps"], "", undefined, compositeContextFor(document)) : [];
  }
  const jobs = document["jobs"];
  if (!isRecord(jobs)) return [];
  const context = workflowContext(document);
  return Object.entries(jobs).flatMap(([id, job]) =>
    isRecord(job) ? runSteps(job["steps"], ["jobs", id, "steps"], `job ${id} `, defaultShell(job) ?? defaultShell(document), () => context) : [],
  );
}

export function findStepFaults(files: readonly YamlFile[]): readonly StepFault[] {
  return files.flatMap((file) => {
    const lines = file.text.split("\n");
    return stepsOf(file).flatMap((step) => {
      const source = scalarSource(lines, step.keys);
      const layout = source === undefined ? ["a run the check cannot locate in the file"] : source.block ? ["a block scalar"] : source.continued ? ["more than one line"] : [];
      const read = step.run === undefined ? ["a run that is not text"] : runFaults(step.run, step.shell, step.context);
      const faults = [...new Set([...layout, ...read])];
      if (faults.length === 0) return [];
      const at = source === undefined ? "" : ` line ${source.line + 1}`;
      return [{ location: `${file.path}${at} ${step.label}`, faults }];
    });
  });
}

export type Result =
  | { readonly enabled: false; readonly violations: readonly [] }
  | { readonly enabled: true; readonly files: number; readonly violations: readonly StepFault[] };

const readSwitch = Effect.fn("readSwitch")(function* (root: string) {
  const fs = yield* FileSystem.FileSystem;
  const file = (yield* Path.Path).join(root, "package.json");
  if (!(yield* fs.exists(file))) return false;
  const { checks } = yield* fs.readFileString(file).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(Schema.fromJsonString(Manifest))),
    Effect.mapError((cause) => new PlainStepsError({ message: `cannot read ${file}: ${cause.message}` })),
  );
  return checks?.plainSteps === true;
});

const parseYaml = (path: string, text: string): Effect.Effect<YamlFile, PlainStepsError> =>
  Effect.try({
    try: () => ({ path, document: Bun.YAML.parse(text), text }),
    catch: (error) => new PlainStepsError({ message: `cannot parse ${path}: ${String(error)}` }),
  });

export const run = Effect.fn("run")(function* (root: string) {
  if (!(yield* readSwitch(root))) return { enabled: false, violations: [] } satisfies Result;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const listed = yield* workingTreeFiles(root).pipe(Effect.mapError((cause) => new PlainStepsError({ message: cause.message })));
  const files = yield* Effect.forEach(listed.filter(isJudged).toSorted(), (file) =>
    fs.readFileString(path.join(root, file)).pipe(
      Effect.mapError((cause) => new PlainStepsError({ message: `cannot read ${file}: ${cause.message}` })),
      Effect.flatMap((text) => parseYaml(file, text)),
    ),
  );
  return { enabled: true, files: files.length, violations: findStepFaults(files) } satisfies Result;
});

export function report(result: Result): string {
  if (!result.enabled) return `${NAME}: off; set ${SWITCH} to true in package.json to turn it on`;
  if (result.violations.length === 0) return `${NAME}: every run step in ${result.files} workflow or action file(s) is one plain command`;
  return [
    `${NAME}: ${result.violations.length} run step(s) are not one plain command; run one command, or call a shared workflow or action that holds the logic:`,
    ...result.violations.map(({ location, faults }) => `  ${location}: ${faults.join(", ")}`),
  ].join("\n");
}

if (import.meta.main) runTreeGate(NAME, run, report);
