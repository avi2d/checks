import { Effect, FileSystem, Path } from "effect";
import { fromProgram, SHELLS, shellWords, withoutOptions, type Command, type Word } from "./shell-command.ts";

// An undefined directory is one known only at run time.
export type Run = {
  readonly script: string;
  readonly dir: string | undefined;
};

type Invocation =
  | { readonly script: string; readonly body: string }
  | { readonly program: Command; readonly file: string | undefined; readonly dir: string | undefined; readonly argv: Command };

type Walked = {
  readonly scripts: readonly string[];
  readonly files: readonly string[];
};

export type BinCheck = (program: Command) => boolean;

type Context = {
  readonly scripts: ReadonlyMap<string, string>;
  readonly files: (file: string) => string | undefined;
};

const MUTATION_BINS = ["checks-mutation", "checks-mutation-compare"];
const BUN_OPERANDS = new Set(["--cwd", "-c", "--config", "--env-file", "-F", "--filter", "-r", "--preload", "--require", "--import", "-e", "--eval", "-p", "--print", "--elide-lines", "--tsconfig-override"]);
// bun's own commands take precedence over a package.json script of the same name unless bun run names it.
const BUN_COMMANDS = new Set(["test", "repl", "exec", "install", "i", "add", "a", "remove", "rm", "update", "outdated", "link", "unlink", "pm", "build", "init", "create", "c", "upgrade", "publish", "patch", "patch-commit", "audit", "info", "why"]);
const SHELL_SHEBANG = new RegExp(String.raw`^#!\s*(?:\S*\/)?(?:env\s+(?:-\S+\s+)*)?(?:${SHELLS.join("|")})(?:\s|$)`);
const UNRESOLVED = /^[/~]|[$`]/;
const ROOT = "";

export function within(dir: string | undefined, path: string): string | undefined {
  if (dir === undefined || UNRESOLVED.test(path)) return undefined;
  const resolved = dir === ROOT ? [] : dir.split("/");
  for (const part of path.split("/")) {
    if (part === ".." && resolved.length === 0) return undefined;
    if (part === "..") resolved.pop();
    else if (part !== "" && part !== ".") resolved.push(part);
  }
  return resolved.join("/");
}

export function runsMutation(run: Run, scripts: ReadonlyMap<string, string>, files: (file: string) => string | undefined): boolean {
  return runsBin(run, scripts, files, mutationBin);
}

export function runsBin(
  run: Run,
  scripts: ReadonlyMap<string, string>,
  files: (file: string) => string | undefined,
  isBin: BinCheck,
  followShellOperands = false,
  reachableOnly = false,
): boolean {
  return scriptRunsBin(run.script, run.dir, { scripts, files }, { scripts: [], files: [] }, isBin, followShellOperands, [], reachableOnly);
}


function isPositionalForward(script: string, word: Word): boolean {
  if (word.text !== "$@") return false;
  if (script[word.start] === '"') return script.slice(word.start, word.start + 4) === '"$@"';
  return script[word.start] === "$" && script[word.start + 1] === "@";
}

function expandArgv(script: string, words: readonly Word[], argv: Command): Command {
  return words.flatMap((word) => (isPositionalForward(script, word) ? argv : [word.text]));
}

function runsExpanded(
  expanded: Command,
  cwd: string | undefined,
  context: Context,
  walked: Walked,
  isBin: BinCheck,
  followShellOperands: boolean,
  reachableOnly: boolean,
): { readonly matched: boolean; readonly cwd: string | undefined } {
  const [program = "", ...args] = fromProgram(expanded);
  if (program === "cd") return { matched: false, cwd: changedDirectory(cwd, withoutOptions(args, new Set())) };
  return { matched: binCommand(expanded, cwd, context, walked, isBin, followShellOperands, reachableOnly), cwd };
}

function scriptRunsBin(
  script: string,
  dir: string | undefined,
  context: Context,
  walked: Walked,
  isBin: BinCheck,
  followShellOperands: boolean,
  argv: Command,
  reachableOnly: boolean,
): boolean {
  const parsed = shellWords(script);
  return reachableOnly
    ? scriptRunsReachable(parsed, script, dir, context, walked, isBin, followShellOperands, argv)
    : scriptRunsAny(parsed, script, dir, context, walked, isBin, followShellOperands, argv, reachableOnly);
}

function scriptRunsAny(
  parsed: readonly (readonly Word[])[],
  script: string,
  dir: string | undefined,
  context: Context,
  walked: Walked,
  isBin: BinCheck,
  followShellOperands: boolean,
  argv: Command,
  reachableOnly: boolean,
): boolean {
  let cwd = dir;
  for (const words of parsed) {
    const next = runsExpanded(expandArgv(script, words, argv), cwd, context, walked, isBin, followShellOperands, reachableOnly);
    if (next.matched) return true;
    cwd = next.cwd;
  }
  return false;
}

const COMPOUND_OPENERS = new Map([
  ["if", "fi"],
  ["while", "done"],
  ["until", "done"],
  ["for", "done"],
  ["case", "esac"],
  ["select", "done"],
]);

const LEADING_WORDS = new Set(["{", "}", "then", "do", "else"]);

type Region = {
  readonly closer: string;
  readonly scan: boolean;
  readonly decided: boolean;
};

function compoundHead(script: string, words: readonly Word[], command: Command): { readonly opener: string; readonly condition: Command } | undefined {
  let index = 0;
  while (index < words.length) {
    const word = words[index];
    if (word === undefined || script[word.start] === '"' || script[word.start] === "'") break;
    if (!LEADING_WORDS.has(word.text)) break;
    index += 1;
  }
  const head = words[index];
  if (head === undefined || script[head.start] === '"' || script[head.start] === "'") return undefined;
  const opener = COMPOUND_OPENERS.get(head.text);
  return opener === undefined ? undefined : { opener, condition: command.slice(index + 1) };
}

function branchTaken(condition: Command): boolean | undefined {
  if (condition.length !== 1 || (condition[0] !== "true" && condition[0] !== "false")) return undefined;
  return condition[0] === "true";
}

function pushIf(opener: string, condition: Command, closers: Region[], live: boolean, parentScan: boolean): boolean {
  const taken = opener === "fi" ? branchTaken(condition) : undefined;
  const certain = live && parentScan;
  closers.push({ closer: opener, scan: certain && taken === true, decided: certain && taken !== undefined });
  return parentScan;
}

function branchStep(head: string | undefined, command: Command, closers: Region[]): boolean {
  const top = closers[closers.length - 1];
  if (top === undefined) return true;
  if (head !== "else" && head !== "elif") return top.scan;
  if (top.scan || !top.decided) {
    closers[closers.length - 1] = { closer: "fi", scan: false, decided: false };
    return false;
  }
  const taken = head === "else" ? true : branchTaken(command.slice(1));
  if (taken !== true) {
    if (taken === undefined) closers[closers.length - 1] = { closer: "fi", scan: false, decided: false };
    return false;
  }
  closers[closers.length - 1] = { closer: "fi", scan: true, decided: true };
  return true;
}

function trackRegion(script: string, words: readonly Word[], command: Command, head: string | undefined, closers: Region[], live: boolean): boolean {
  const top = closers[closers.length - 1];
  const found = compoundHead(script, words, command);
  if (top === undefined) {
    if (found === undefined) return true;
    return pushIf(found.opener, found.condition, closers, live, true);
  }
  if (top.closer !== "fi") {
    if (found !== undefined) closers.push({ closer: found.opener, scan: false, decided: false });
    else if (head === top.closer) closers.pop();
    return false;
  }
  if (found !== undefined) return pushIf(found.opener, found.condition, closers, live, top.scan);
  if (head === "fi") {
    closers.pop();
    return false;
  }
  return branchStep(head, command, closers);
}

type ReachState = { closers: Region[]; live: boolean; cwd: string | undefined };

function stepReachable(
  script: string,
  words: readonly Word[],
  command: Command,
  previous: Command | undefined,
  argv: Command,
  context: Context,
  walked: Walked,
  isBin: BinCheck,
  followShellOperands: boolean,
  state: ReachState,
): ReachState | true {
  const start = words[0]?.start ?? 0;
  const head = script[start] === '"' || script[start] === "'" ? undefined : command[0];
  const live = connectorLive(script, words, previous, state.live);
  if (!trackRegion(script, words, command, head, state.closers, live)) return { ...state, live };
  if (!live) return { ...state, live };
  const expanded = expandArgv(script, words, argv);
  const next = runsExpanded(expanded, state.cwd, context, walked, isBin, followShellOperands, true);
  if (next.matched) return true;
  return { ...state, live, cwd: next.cwd };
}

function scriptRunsReachable(
  parsed: readonly (readonly Word[])[],
  script: string,
  dir: string | undefined,
  context: Context,
  walked: Walked,
  isBin: BinCheck,
  followShellOperands: boolean,
  argv: Command,
): boolean {
  const texts = parsed.map((words) => words.map(({ text }) => text));
  let state: ReachState = { closers: [], live: true, cwd: dir };
  for (const [index, words] of parsed.entries()) {
    const command = texts[index] ?? [];
    const stepped = stepReachable(script, words, command, texts[index - 1], argv, context, walked, isBin, followShellOperands, state);
    if (stepped === true) return true;
    state = stepped;
  }
  return false;
}

function connectorLive(script: string, words: readonly Word[], previous: Command | undefined, live: boolean): boolean {
  let at = (words[0]?.start ?? 0) - 1;
  while (script[at] === " " || script[at] === "\t" || script[at] === "\n" || script[at] === "\r") at -= 1;
  const mark = script[at] ?? "";
  const raw = previous ?? [];
  const [program = ""] = raw[0] === "!" ? [""] : fromProgram(raw);
  const dead = program === "false";
  if (mark === "&" && script[at - 1] === "&") return live && !dead;
  if (mark === "|" && script[at - 1] === "|") return live && (dead || program !== "true");
  return true;
}

function changedDirectory(cwd: string | undefined, [target]: Command): string | undefined {
  return target === undefined || target === "-" ? undefined : within(cwd, target);
}

function bunOptions(words: Command): Command {
  return words.slice(0, words.length - withoutOptions(words, BUN_OPERANDS).length);
}

function bunDirectory(options: Command, dir: string | undefined): string | undefined {
  return options.reduce<string | undefined>((current, word, index) => {
    const value = word === "--cwd" ? options[index + 1] : word.startsWith("--cwd=") ? word.slice("--cwd=".length) : undefined;
    return value === undefined ? current : within(dir, value);
  }, dir);
}

function fileAt(dir: string | undefined, path: string): string | undefined {
  return within(dir, path) || undefined;
}

const PLAIN_WORD = /^[A-Za-z0-9_@%+=:,./-]+$/;

function quotedWord(word: string): string {
  if (word !== "" && PLAIN_WORD.test(word)) return word;
  return `'${word.replace(/'/g, "'\\''")}'`;
}

function invocation(command: Command, dir: string | undefined, context: Context, walked: Walked, followShellOperands: boolean): Invocation | undefined {
  const [first = "", ...rest] = fromProgram(command);
  if (first !== "bun") {
    if (followShellOperands && rest[0] !== undefined && !rest[0].startsWith("-") && SHELLS.includes(first.slice(first.lastIndexOf("/") + 1))) {
      return { program: [first, ...rest], file: fileAt(dir, rest[0]), dir, argv: rest.slice(1) };
    }
    return { program: [first, ...rest], file: first.includes("/") ? fileAt(dir, first) : undefined, dir, argv: rest };
  }
  const [subcommand = "", ...operands] = withoutOptions(rest, BUN_OPERANDS);
  if (subcommand === "x") return invocation(["bunx", ...operands], dir, context, walked, followShellOperands);
  if (BUN_COMMANDS.has(subcommand)) return undefined;
  const [target = "", ...targetArgs] = subcommand === "run" ? withoutOptions(operands, BUN_OPERANDS) : [subcommand, ...operands];
  const cwd = bunDirectory([...bunOptions(rest), ...(subcommand === "run" ? bunOptions(operands) : [])], dir);
  const body = walked.scripts.includes(target) ? undefined : context.scripts.get(target);
  if (body === undefined) return { program: [target, ...targetArgs], file: fileAt(cwd, target), dir: cwd, argv: targetArgs };
  return { script: target, body: targetArgs.length === 0 ? body : `${body} ${targetArgs.map(quotedWord).join(" ")}` };
}

function binCommand(
  command: Command,
  dir: string | undefined,
  context: Context,
  walked: Walked,
  isBin: BinCheck,
  followShellOperands: boolean,
  reachableOnly: boolean,
): boolean {
  const call = invocation(command, dir, context, walked, followShellOperands);
  if (call === undefined) return false;
  // bun runs a script from the directory of the package.json that names it.
  if ("body" in call)
    return scriptRunsBin(call.body, ROOT, context, { ...walked, scripts: [...walked.scripts, call.script] }, isBin, followShellOperands, [], reachableOnly);
  return isBin(call.program) || fileRunsBin(call.file, call.dir, call.argv, context, walked, isBin, followShellOperands, reachableOnly);
}

// A script file runs in its caller's directory, not its own.
function fileRunsBin(
  file: string | undefined,
  dir: string | undefined,
  argv: Command,
  context: Context,
  walked: Walked,
  isBin: BinCheck,
  followShellOperands: boolean,
  reachableOnly: boolean,
): boolean {
  if (file === undefined || walked.files.includes(file)) return false;
  const body = context.files(file);
  return (
    body !== undefined &&
    scriptRunsBin(body, dir, context, { ...walked, files: [...walked.files, file] }, isBin, followShellOperands, argv, reachableOnly)
  );
}

function mutationBin([program = "", subcommand]: Command): boolean {
  const bin = program.slice(program.lastIndexOf("/") + 1);
  return MUTATION_BINS.includes(bin) || (bin === "stryker" && subcommand === "run");
}

type FilesWanted = (runs: readonly Run[], scripts: ReadonlyMap<string, string>, files: ReadonlyMap<string, string>, read: ReadonlySet<string>) => readonly string[];

type Walk = (run: Run, scripts: ReadonlyMap<string, string>, files: (file: string) => string | undefined) => void;

function wantedBy(walk: Walk): FilesWanted {
  return (runs, scripts, files, read) => {
    const wanted = new Set<string>();
    const lookup = (file: string) => {
      if (!read.has(file)) wanted.add(file);
      return files.get(file);
    };
    for (const run of runs) walk(run, scripts, lookup);
    return [...wanted];
  };
}

const filesWanted = wantedBy(runsMutation);
const scheduleFilesWanted = wantedBy((run, scripts, files) => runsBin(run, scripts, files, () => false, true));

const readFiles = Effect.fn("readFiles")(function* (root: string, scripts: ReadonlyMap<string, string>, runs: readonly Run[], wanted: FilesWanted) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const contents = new Map<string, string>();
  const read = new Set<string>();
  for (let pending = wanted(runs, scripts, contents, read); pending.length > 0; pending = wanted(runs, scripts, contents, read)) {
    for (const file of pending) {
      read.add(file);
      const text = yield* fs.readFileString(path.join(root, file)).pipe(Effect.orElseSucceed(() => undefined));
      if (text !== undefined && (file.endsWith(".sh") || SHELL_SHEBANG.test(text))) contents.set(file, text);
    }
  }
  return contents;
});

export const readShellFiles = Effect.fn("readShellFiles")(function* (root: string, scripts: ReadonlyMap<string, string>, runs: readonly Run[]) {
  return yield* readFiles(root, scripts, runs, filesWanted);
});

export const readScheduleFiles = Effect.fn("readScheduleFiles")(function* (root: string, scripts: ReadonlyMap<string, string>, runs: readonly Run[]) {
  return yield* readFiles(root, scripts, runs, scheduleFilesWanted);
});
