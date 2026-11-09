#!/usr/bin/env bun
import { Effect, FileSystem, Path, Schema } from "effect";
import { workingTreeFiles } from "../core/git.ts";
import { runTreeGate } from "../core/main.ts";
import { fromProgram, REDIRECT_OPERATOR, SHELLS, shellWords, substitutionEnd } from "./shell-command.ts";
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

type RunStep = {
  readonly keys: readonly (string | number)[];
  readonly label: string;
  readonly run: string | undefined;
  readonly shell: unknown;
};

const NAME = "plain-steps";
const SWITCH = "checks.plainSteps";
const WORKFLOWS = ".github/workflows/";
const ACTION_FILES = new Set(["action.yml", "action.yaml"]);
const UNJUDGED_PREFIXES = ["node_modules/", "repos/", "tests/fixtures/"] as const;
const PLAIN_SHELLS = new Set(["bash", "sh", "pwsh", "powershell", "cmd"]);
const SIMPLE_EXPANSION = /^\$\{[A-Za-z_][A-Za-z0-9_]*\}/;
const CONTROL_OPERATORS: readonly (readonly [string, string])[] = [
  ["&&", "a command list"],
  ["||", "a command list"],
  [";", "a command list"],
  ["|", "a pipe"],
  ["&", "a background job"],
  ["(", "a subshell"],
  [")", "a subshell"],
];
const INLINE_CODE_FLAGS = new Map<string, readonly string[]>([
  ...SHELLS.map((shell) => [shell, ["-c"]] as const),
  ["node", ["-e", "--eval", "-p", "--print"]],
  ["bun", ["-e", "--eval", "-p", "--print"]],
  ["python", ["-c"]],
  ["python3", ["-c"]],
  ["perl", ["-e", "-E"]],
  ["ruby", ["-e"]],
  ["php", ["-r", "-R", "-B", "-E"]],
  ["osascript", ["-e"]],
  ["cmd", ["/c", "/k"]],
]);
const SCRIPT_PROGRAMS = new Set(["eval", "awk", "gawk", "mawk", "nawk", "sed"]);

const Manifest = Schema.Struct({
  checks: Schema.optional(Schema.Struct({ plainSteps: Schema.optional(Schema.Boolean) })),
});

class PlainStepsError extends Schema.TaggedError<PlainStepsError>()("PlainStepsError", {
  message: Schema.String,
}) {}

function baseNameOf(file: string): string {
  const base = file.slice(file.lastIndexOf("/") + 1);
  return base.toLowerCase().endsWith(".exe") ? base.slice(0, -4) : base;
}

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

function hasScriptFile(rest: readonly string[]): boolean {
  return rest.some((word) => word === "-f" || word === "--file" || word.toLowerCase().startsWith("--file="));
}

function pwshInlineFlag(word: string): boolean {
  const base = word.toLowerCase().split("=")[0] ?? "";
  if (!base.startsWith("-") || base.startsWith("--")) return false;
  const name = base.slice(1);
  return name !== "" && ("command".startsWith(name) || "encodedcommand".startsWith(name) || "commandwithargs".startsWith(name) || name === "ec" || name === "cwa");
}

function hasFlag(word: string, program: string, flags: readonly string[]): boolean {
  const text = program === "cmd" ? word.toLowerCase() : word;
  return flags.some((flag) => text === flag || text.startsWith(flag + "="));
}

const INLINE_LETTERS = new Map<string, readonly string[]>([
  ...SHELLS.map((shell) => [shell, ["c"]] as const),
  ["node", ["e", "p"]],
  ["bun", ["e", "p"]],
  ["python", ["c"]],
  ["python3", ["c"]],
  ["perl", ["e", "E"]],
  ["ruby", ["e"]],
  ["php", ["r", "R", "B", "E"]],
  ["osascript", ["e"]],
]);
const VALUED_LETTERS = new Map<string, readonly string[]>([
  ...SHELLS.map((shell) => [shell, ["o", "O"]] as const),
  ["node", ["r", "C"]],
  ["bun", ["r", "C"]],
  ["python", ["W", "X"]],
  ["python3", ["W", "X"]],
  ["perl", ["M", "I"]],
  ["ruby", ["r", "E"]],
]);

function scanBundle(letters: string, program: string): "inline" | "valued" | "none" {
  const inline = INLINE_LETTERS.get(program) ?? [];
  const valued = VALUED_LETTERS.get(program) ?? [];
  for (let at = 0; at < letters.length; at += 1) {
    const letter = letters.charAt(at);
    if (inline.includes(letter)) return "inline";
    if (valued.includes(letter)) return at === letters.length - 1 ? "valued" : "none";
  }
  return "none";
}

const SHELL_VALUE_OPTIONS = new Set(["-o", "+o", "-O", "+O"]);
const NODE_VALUE_OPTIONS = new Set(["-r", "--require", "--import", "-C", "--cwd"]);
const PYTHON_VALUE_OPTIONS = new Set(["-W", "-X"]);
const PWSH_SWITCHES = new Set(["-nologo", "-noprofile", "-noninteractive", "-noexit", "-sta", "-mta", "-help", "-?"]);
const TIMEOUT_VALUE_OPTIONS = new Set(["-k", "--kill-after", "-s", "--signal"]);
const NICE_VALUE_OPTIONS = new Set(["-n", "--adjustment"]);
const XARGS_VALUE_OPTIONS = new Set(["-a", "--arg-file", "-d", "--delimiter", "-E", "-e", "--eof", "-I", "--replace", "-L", "--max-lines", "-n", "--max-args", "-P", "--max-procs", "-s", "--max-chars"]);
const DOCKER_VALUE_OPTIONS = new Set(["--add-host", "-c", "--cpu-shares", "--cpus", "--cap-add", "--cap-drop", "--cpuset-cpus", "--cpuset-mems", "--cidfile", "--detach-keys", "--device", "--dns", "--dns-option", "--dns-search", "--entrypoint", "-e", "--env", "--env-file", "--expose", "--group-add", "--gpus", "-h", "--hostname", "--health-cmd", "--health-interval", "--health-retries", "--health-start-period", "--health-timeout", "--ip", "--ipc", "-l", "--label", "--link", "--log-driver", "--log-opt", "--mac-address", "-m", "--memory", "--mount", "--name", "--network", "-p", "--publish", "--pid", "--pull", "--platform", "--restart", "--runtime", "--security-opt", "--shm-size", "--stop-signal", "--stop-timeout", "--storage-opt", "--sysctl", "--tmpfs", "-u", "--user", "--userns", "--ulimit", "-v", "--volume", "--volumes-from", "-w", "--workdir"]);

function valueOptions(program: string): ReadonlySet<string> | undefined {
  if (program === "node" || program === "bun") return NODE_VALUE_OPTIONS;
  if (program === "python" || program === "python3") return PYTHON_VALUE_OPTIONS;
  if (SHELLS.includes(program)) return SHELL_VALUE_OPTIONS;
  return undefined;
}

function interpreterInlineArgs(rest: readonly string[], program: string, flags: readonly string[]): boolean {
  const values = valueOptions(program);
  const plus = SHELLS.includes(program);
  for (let index = 0; index < rest.length; index += 1) {
    const word = rest[index] ?? "";
    if (word === "--") return false;
    const slash = program === "cmd" && word.length > 1 && word.startsWith("/");
    const dash = (word.startsWith("-") && word !== "-") || slash;
    const bundle = !dash && plus && /^[+][A-Za-z]+$/.test(word) ? word.slice(1) : undefined;
    if (!dash && bundle === undefined) return false;
    if (dash && hasFlag(word, program, flags)) return true;
    const letters = dash ? word.slice(1) : (bundle ?? "");
    if (/^[A-Za-z]+$/.test(letters)) {
      const found = scanBundle(letters, program);
      if (found === "inline") return true;
      if (found === "valued") index += 1;
      continue;
    }
    const base = word.split("=")[0] ?? "";
    if (values?.has(base) === true && !word.includes("=")) index += 1;
  }
  return false;
}

function pwshInlineArgs(rest: readonly string[]): boolean {
  for (let index = 0; index < rest.length; index += 1) {
    const word = rest[index] ?? "";
    if (word === "--") return false;
    if (!word.startsWith("-") || word === "-") {
      const prev = (rest[index - 1] ?? "").toLowerCase().split("=")[0] ?? "";
      if (index > 0 && prev.startsWith("-") && prev !== "-" && !PWSH_SWITCHES.has(prev)) continue;
      return false;
    }
    const base = word.toLowerCase().split("=")[0] ?? "";
    if (base === "-file" || base === "-f") return false;
    if (pwshInlineFlag(word)) return true;
  }
  return false;
}

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
  if (baseNameOf(slice[0] ?? "").toLowerCase() === "npx" && npxUsesCall(slice.slice(1))) return true;
  const resolved = fromProgram(slice);
  const [program = "", ...rest] = resolved;
  const name = baseNameOf(program).toLowerCase();
  if (SCRIPT_PROGRAMS.has(name)) {
    if (!hasScriptFile(rest)) return true;
  } else if (name === "deno") {
    if (rest[0] === "eval") return true;
  } else if (name === "pwsh" || name === "powershell") {
    if (pwshInlineArgs(rest)) return true;
  } else {
    const flags = INLINE_CODE_FLAGS.get(name);
    if (flags !== undefined && interpreterInlineArgs(rest, name, flags)) return true;
  }
  if (handoffs(slice).some((sub) => checkSlice(sub))) return true;
  return resolved !== slice && handoffs(resolved).some((sub) => checkSlice(sub));
}

function npxUsesCall(rest: readonly string[]): boolean {
  for (let index = 0; index < rest.length; index += 1) {
    const word = rest[index] ?? "";
    if (word === "--") return false;
    if (!word.startsWith("-") || word === "-") return false;
    const base = word.toLowerCase().split("=")[0] ?? "";
    if (base === "-c" || base === "--call") return true;
    if ((base === "-p" || base === "--package" || base === "-w" || base === "--workspace") && !word.includes("=")) index += 1;
  }
  return false;
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

export function runFaults(run: string, shell: unknown): readonly string[] {
  const line = run.trim();
  if (line === "") return ["no command"];
  const plain = maskExpressions(line);
  const faults = [...shellConstructs(plain)];
  if (line.includes("\n")) faults.push("more than one line");
  const [words = []] = shellWords(plain);
  const texts = words.map(({ text }) => text);
  if (runsInlineCode(texts)) faults.push("inline interpreter code");
  if (fromProgram(texts)[0]?.includes("$") === true) faults.push("a command named only at run time");
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

function runSteps(steps: unknown, keys: readonly (string | number)[], prefix: string, inherited: unknown): readonly RunStep[] {
  if (!Array.isArray(steps)) return [];
  return steps.flatMap((step: unknown, index) => {
    if (!isRecord(step) || step["run"] === undefined) return [];
    return [{
      keys: [...keys, index, "run"],
      label: prefix + stepLabel(step, index),
      run: typeof step["run"] === "string" || typeof step["run"] === "number" ? `${step["run"]}` : undefined,
      shell: step["shell"] ?? inherited,
    }];
  });
}

function stepsOf(file: YamlFile): readonly RunStep[] {
  const { document } = file;
  if (!isRecord(document)) return [];
  if (!file.path.startsWith(WORKFLOWS)) {
    const runs = document["runs"];
    return isRecord(runs) ? runSteps(runs["steps"], ["runs", "steps"], "", undefined) : [];
  }
  const jobs = document["jobs"];
  if (!isRecord(jobs)) return [];
  return Object.entries(jobs).flatMap(([id, job]) =>
    isRecord(job) ? runSteps(job["steps"], ["jobs", id, "steps"], `job ${id} `, defaultShell(job) ?? defaultShell(document)) : [],
  );
}

export function findStepFaults(files: readonly YamlFile[]): readonly StepFault[] {
  return files.flatMap((file) => {
    const lines = file.text.split("\n");
    return stepsOf(file).flatMap((step) => {
      const source = scalarSource(lines, step.keys);
      const layout = source === undefined ? ["a run the check cannot locate in the file"] : source.block ? ["a block scalar"] : source.continued ? ["more than one line"] : [];
      const read = step.run === undefined ? ["a run that is not text"] : runFaults(step.run, step.shell);
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
