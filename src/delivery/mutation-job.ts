import { Effect, FileSystem, Path } from "effect";
import { fromProgram, SHELLS, shellCommands, withoutOptions, type Command } from "./shell-command.ts";

// An undefined directory is one known only at run time.
export type Run = {
  readonly script: string;
  readonly dir: string | undefined;
};

type Invocation =
  | { readonly script: string; readonly body: string }
  | { readonly program: Command; readonly file: string | undefined; readonly dir: string | undefined };

type Walked = {
  readonly scripts: readonly string[];
  readonly files: readonly string[];
};

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
  return scriptRunsMutation(run.script, run.dir, { scripts, files }, { scripts: [], files: [] });
}

function scriptRunsMutation(script: string, dir: string | undefined, context: Context, walked: Walked): boolean {
  let cwd = dir;
  for (const command of shellCommands(script)) {
    const [program = "", ...args] = fromProgram(command);
    if (program === "cd") cwd = changedDirectory(cwd, withoutOptions(args, new Set()));
    else if (mutationCommand(command, cwd, context, walked)) return true;
  }
  return false;
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

function invocation(command: Command, dir: string | undefined, context: Context, walked: Walked): Invocation | undefined {
  const [first = "", ...rest] = fromProgram(command);
  if (first !== "bun") return { program: [first, ...rest], file: first.includes("/") ? fileAt(dir, first) : undefined, dir };
  const [subcommand = "", ...operands] = withoutOptions(rest, BUN_OPERANDS);
  if (subcommand === "x") return invocation(["bunx", ...operands], dir, context, walked);
  if (BUN_COMMANDS.has(subcommand)) return undefined;
  const [target = "", ...targetArgs] = subcommand === "run" ? withoutOptions(operands, BUN_OPERANDS) : [subcommand, ...operands];
  const cwd = bunDirectory([...bunOptions(rest), ...(subcommand === "run" ? bunOptions(operands) : [])], dir);
  const body = walked.scripts.includes(target) ? undefined : context.scripts.get(target);
  return body === undefined ? { program: [target, ...targetArgs], file: fileAt(cwd, target), dir: cwd } : { script: target, body };
}

function mutationCommand(command: Command, dir: string | undefined, context: Context, walked: Walked): boolean {
  const call = invocation(command, dir, context, walked);
  if (call === undefined) return false;
  // bun runs a script from the directory of the package.json that names it.
  if ("body" in call) return scriptRunsMutation(call.body, ROOT, context, { ...walked, scripts: [...walked.scripts, call.script] });
  return mutationBin(call.program) || fileRunsMutation(call.file, call.dir, context, walked);
}

// A script file runs in its caller's directory, not its own.
function fileRunsMutation(file: string | undefined, dir: string | undefined, context: Context, walked: Walked): boolean {
  if (file === undefined || walked.files.includes(file)) return false;
  const body = context.files(file);
  return body !== undefined && scriptRunsMutation(body, dir, context, { ...walked, files: [...walked.files, file] });
}

function mutationBin([program = "", subcommand]: Command): boolean {
  const bin = program.slice(program.lastIndexOf("/") + 1);
  return MUTATION_BINS.includes(bin) || (bin === "stryker" && subcommand === "run");
}

function filesWanted(runs: readonly Run[], scripts: ReadonlyMap<string, string>, files: ReadonlyMap<string, string>, read: ReadonlySet<string>): readonly string[] {
  const wanted = new Set<string>();
  const lookup = (file: string) => {
    if (!read.has(file)) wanted.add(file);
    return files.get(file);
  };
  for (const run of runs) runsMutation(run, scripts, lookup);
  return [...wanted];
}

export const readShellFiles = Effect.fn("readShellFiles")(function* (root: string, scripts: ReadonlyMap<string, string>, runs: readonly Run[]) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const contents = new Map<string, string>();
  const read = new Set<string>();
  for (let wanted = filesWanted(runs, scripts, contents, read); wanted.length > 0; wanted = filesWanted(runs, scripts, contents, read)) {
    for (const file of wanted) {
      read.add(file);
      const text = yield* fs.readFileString(path.join(root, file)).pipe(Effect.orElseSucceed(() => undefined));
      if (text !== undefined && (file.endsWith(".sh") || SHELL_SHEBANG.test(text))) contents.set(file, text);
    }
  }
  return contents;
});
