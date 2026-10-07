import { Effect, FileSystem, Path } from "effect";
import { fromProgram, repoFile, shellCommands, withoutOptions, type Command } from "./shell-command.ts";

type Invocation =
  | { readonly script: string; readonly body: string }
  | { readonly program: Command; readonly file: string | undefined };

const MUTATION_BINS = ["checks-mutation", "checks-mutation-compare"];
const BUN_OPERANDS = new Set(["--cwd", "-c", "--config", "--env-file", "-F", "--filter", "-r", "--preload", "--require", "--import", "-e", "--eval", "-p", "--print", "--elide-lines", "--tsconfig-override"]);
// bun's own commands take precedence over a package.json script of the same name unless bun run names it.
const BUN_COMMANDS = new Set(["test", "repl", "exec", "install", "i", "add", "a", "remove", "rm", "update", "outdated", "link", "unlink", "pm", "build", "init", "create", "c", "upgrade", "publish", "patch", "patch-commit", "audit", "info", "why"]);
const SHELL_SHEBANG = /^#!\s*(?:\S*\/)?(?:env\s+(?:-\S+\s+)*)?(?:ba|da|k|z)?sh(?:\s|$)/;

export function runsMutation(script: string, scripts: ReadonlyMap<string, string>, files: ReadonlyMap<string, string>, walked: readonly string[] = []): boolean {
  return shellCommands(script).some((command) => mutationCommand(command, scripts, files, walked));
}

function invocation(command: Command, scripts: ReadonlyMap<string, string>, walked: readonly string[]): Invocation | undefined {
  const [first = "", ...rest] = fromProgram(command);
  if (first !== "bun") return { program: [first, ...rest], file: first.includes("/") ? repoFile(first) : undefined };
  const [subcommand = "", ...operands] = withoutOptions(rest, BUN_OPERANDS);
  if (subcommand === "x") return invocation(["bunx", ...operands], scripts, walked);
  if (BUN_COMMANDS.has(subcommand)) return undefined;
  const [target = "", ...targetArgs] = subcommand === "run" ? withoutOptions(operands, BUN_OPERANDS) : [subcommand, ...operands];
  const body = walked.includes(target) ? undefined : scripts.get(target);
  return body === undefined ? { program: [target, ...targetArgs], file: repoFile(target) } : { script: target, body };
}

function mutationCommand(command: Command, scripts: ReadonlyMap<string, string>, files: ReadonlyMap<string, string>, walked: readonly string[]): boolean {
  const call = invocation(command, scripts, walked);
  if (call === undefined) return false;
  if ("body" in call) return runsMutation(call.body, scripts, files, [...walked, call.script]);
  return mutationBin(call.program) || fileRunsMutation(call.file, scripts, files, walked);
}

function fileRunsMutation(file: string | undefined, scripts: ReadonlyMap<string, string>, files: ReadonlyMap<string, string>, walked: readonly string[]): boolean {
  if (file === undefined || walked.includes(file)) return false;
  const body = files.get(file);
  return body !== undefined && runsMutation(body, scripts, files, [...walked, file]);
}

function filesRun(text: string, scripts: ReadonlyMap<string, string>): readonly string[] {
  return shellCommands(text).flatMap((command) => {
    const call = invocation(command, scripts, []);
    return call === undefined || "body" in call || call.file === undefined ? [] : [call.file];
  });
}

function mutationBin([program = "", subcommand]: Command): boolean {
  const bin = program.slice(program.lastIndexOf("/") + 1);
  return MUTATION_BINS.includes(bin) || (bin === "stryker" && subcommand === "run");
}

export const readShellFiles = Effect.fn("readShellFiles")(function* (root: string, scripts: ReadonlyMap<string, string>, texts: readonly string[]) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const contents = new Map<string, string>();
  const seen = new Set<string>();
  const queue = texts.flatMap((text) => filesRun(text, scripts));
  while (queue.length > 0) {
    const file = queue.pop();
    if (file === undefined || seen.has(file)) continue;
    seen.add(file);
    const text = yield* fs.readFileString(path.join(root, file)).pipe(Effect.orElseSucceed(() => undefined));
    if (text === undefined || !(file.endsWith(".sh") || SHELL_SHEBANG.test(text))) continue;
    contents.set(file, text);
    queue.push(...filesRun(text, scripts));
  }
  return contents;
});
