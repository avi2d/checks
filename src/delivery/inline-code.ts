import { SHELLS } from "./shell-command.ts";

export function baseNameOf(file: string): string {
  const base = file.slice(file.lastIndexOf("/") + 1);
  return base.toLowerCase().endsWith(".exe") ? base.slice(0, -4) : base;
}

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

function valueOptions(program: string): ReadonlySet<string> | undefined {
  if (program === "node" || program === "bun") return NODE_VALUE_OPTIONS;
  if (program === "python" || program === "python3") return PYTHON_VALUE_OPTIONS;
  if (SHELLS.includes(program)) return SHELL_VALUE_OPTIONS;
  return undefined;
}

function isSlashFlag(word: string, program: string): boolean {
  return program === "cmd" && word.length > 1 && word.startsWith("/");
}

function isOptionWord(word: string, program: string): boolean {
  return isSlashFlag(word, program) || (word.startsWith("-") && word !== "-");
}

function plusBundle(word: string, plus: boolean): string | undefined {
  if (!plus) return undefined;
  return /^[+][A-Za-z]+$/.test(word) ? word.slice(1) : undefined;
}

type OptionScan = "inline" | "operand" | "skip" | "next";

function scanBundleLetters(letters: string, program: string): OptionScan {
  const found = scanBundle(letters, program);
  if (found === "inline") return "inline";
  if (found === "valued") return "skip";
  return "next";
}

function scanValuedOption(word: string, values: ReadonlySet<string> | undefined): OptionScan {
  const base = word.split("=")[0] ?? "";
  if (!word.includes("=") && values?.has(base) === true) return "skip";
  return "next";
}

function scanOption(word: string, program: string, flags: readonly string[], values: ReadonlySet<string> | undefined, plus: boolean): OptionScan {
  const dash = isOptionWord(word, program);
  const bundle = dash ? undefined : plusBundle(word, plus);
  if (!dash && bundle === undefined) return "operand";
  if (dash && hasFlag(word, program, flags)) return "inline";
  const letters = dash ? word.slice(1) : (bundle ?? "");
  if (/^[A-Za-z]+$/.test(letters)) return scanBundleLetters(letters, program);
  return scanValuedOption(word, values);
}

function interpreterInlineArgs(rest: readonly string[], program: string, flags: readonly string[]): boolean {
  const values = valueOptions(program);
  const plus = SHELLS.includes(program);
  for (let index = 0; index < rest.length; index += 1) {
    const word = rest[index] ?? "";
    if (word === "--") return false;
    const scan = scanOption(word, program, flags, values, plus);
    if (scan === "operand") return false;
    if (scan === "inline") return true;
    if (scan === "skip") index += 1;
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

export function resolvedUsesInlineCode(resolved: readonly string[]): boolean {
  const [program = "", ...rest] = resolved;
  const name = baseNameOf(program).toLowerCase();
  if (SCRIPT_PROGRAMS.has(name)) return !hasScriptFile(rest);
  if (name === "deno") return rest[0] === "eval";
  if (name === "pwsh" || name === "powershell") return pwshInlineArgs(rest);
  const flags = INLINE_CODE_FLAGS.get(name);
  return flags !== undefined && interpreterInlineArgs(rest, name, flags);
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

export function isNpxCall(slice: readonly string[]): boolean {
  if (baseNameOf(slice[0] ?? "").toLowerCase() !== "npx") return false;
  return npxUsesCall(slice.slice(1));
}
