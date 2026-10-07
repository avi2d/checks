export type Command = readonly string[];

type Span = {
  readonly text: string;
  readonly end: number;
};

const VARIABLE = /^\$(?:[A-Za-z_][A-Za-z0-9_]*|\{[A-Za-z_][A-Za-z0-9_]*\})/;
const UNPLAIN = new Set(["|", "&", ";", "<", ">", "(", ")", "`", "\\", "#", "\n"]);

function variable(line: string, from: number): Span | undefined {
  const match = VARIABLE.exec(line.slice(from));
  return match === null ? undefined : { text: match[0], end: from + match[0].length };
}

function singleQuoted(line: string, open: number): Span | undefined {
  const close = line.indexOf("'", open + 1);
  return close === -1 ? undefined : { text: line.slice(open + 1, close), end: close + 1 };
}

function doubleQuoted(line: string, open: number): Span | undefined {
  let text = "";
  let index = open + 1;
  while (line.charAt(index) !== '"') {
    const inner = line.charAt(index);
    if (inner === "" || inner === "\\" || inner === "`") return undefined;
    const part = inner === "$" ? variable(line, index) : { text: inner, end: index + 1 };
    if (part === undefined) return undefined;
    text += part.text;
    index = part.end;
  }
  return { text, end: index + 1 };
}

function wordPart(line: string, index: number): Span | undefined {
  const char = line.charAt(index);
  if (char === "'") return singleQuoted(line, index);
  if (char === '"') return doubleQuoted(line, index);
  if (char === "$") return variable(line, index);
  return UNPLAIN.has(char) ? undefined : { text: char, end: index + 1 };
}

// A script counts only when it is one line of plain words: any shell control, redirection or
// substitution can run the gate without its failure failing the step.
export function plainCommand(script: string): Command | undefined {
  const line = script.trim();
  const words: string[] = [];
  let word: string | undefined;
  let index = 0;
  while (index < line.length) {
    const char = line.charAt(index);
    if (char === " " || char === "\t") {
      if (word !== undefined) words.push(word);
      word = undefined;
      index += 1;
    } else {
      const part = wordPart(line, index);
      if (part === undefined) return undefined;
      word = (word ?? "") + part.text;
      index = part.end;
    }
  }
  if (word !== undefined) words.push(word);
  return words.length === 0 ? undefined : words;
}

type ShellPart = Span & { readonly substitutions: readonly string[] };

const COMMAND_BREAKS = new Set(["\n", ";", "&", "|", "(", ")", "`"]);
const WORD_BREAKS = new Set([" ", "\t"]);
const REDIRECTS = new Set(["<", ">"]);
const REDIRECT_OPERATOR = /^[<>][<>&|]*/;
const DELIMITER_BREAKS = new Set([...WORD_BREAKS, ...COMMAND_BREAKS, ...REDIRECTS]);
const FILE_DESCRIPTOR = /^\d+$/;
const DOUBLE_QUOTE_ESCAPES = new Set(["$", "`", '"', "\\"]);
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;
const RESERVED_WORDS = new Set(["!", "{", "if", "then", "elif", "else", "while", "until", "do"]);
const LAUNCHER_OPERANDS = new Map<string, ReadonlySet<string>>([
  ["time", new Set(["-o", "-f"])],
  ["env", new Set(["-u", "-C", "--unset", "--chdir"])],
  ["exec", new Set(["-a"])],
  ["nohup", new Set()],
  ["sudo", new Set(["-u", "-g", "-C", "-D", "-h", "-p", "-r", "-t", "-U", "--user", "--group", "--chdir", "--host", "--prompt"])],
  ["bunx", new Set(["-p", "--package"])],
  ["npx", new Set(["-p", "--package", "-c", "--call", "-w", "--workspace"])],
]);

function substitutionEnd(script: string, start: number): number {
  if (script.charAt(start) === "`") {
    const close = script.indexOf("`", start + 1);
    return close === -1 ? script.length : close;
  }
  let depth = 0;
  for (let index = start + 1; index < script.length; index += 1) {
    if (script.charAt(index) === "(") depth += 1;
    if (script.charAt(index) === ")") depth -= 1;
    if (depth === 0) return index;
  }
  return script.length;
}

function doubleQuotedPart(script: string, index: number): ShellPart {
  const char = script.charAt(index);
  const next = script.charAt(index + 1);
  if (char === "\\" && next === "\n") return { text: "", end: index + 2, substitutions: [] };
  if (char === "\\" && DOUBLE_QUOTE_ESCAPES.has(next)) return { text: next, end: index + 2, substitutions: [] };
  if (char !== "`" && !(char === "$" && next === "(")) return { text: char, end: index + 1, substitutions: [] };
  const end = substitutionEnd(script, index);
  return { text: "", end: end + 1, substitutions: [script.slice(index + (char === "`" ? 1 : 2), end)] };
}

function shellDoubleQuoted(script: string, open: number): ShellPart {
  let text = "";
  const substitutions: string[] = [];
  let index = open + 1;
  while (index < script.length && script.charAt(index) !== '"') {
    const part = doubleQuotedPart(script, index);
    text += part.text;
    substitutions.push(...part.substitutions);
    index = part.end;
  }
  return { text, end: index + 1, substitutions };
}

function shellPart(script: string, index: number): ShellPart {
  const char = script.charAt(index);
  if (char === "'") {
    const close = script.indexOf("'", index + 1);
    const end = close === -1 ? script.length : close;
    return { text: script.slice(index + 1, end), end: end + 1, substitutions: [] };
  }
  if (char === '"') return shellDoubleQuoted(script, index);
  if (char === "\\") return { text: script.charAt(index + 1), end: index + 2, substitutions: [] };
  return { text: char, end: index + 1, substitutions: [] };
}

function commentEnd(script: string, from: number): number {
  const newline = script.indexOf("\n", from);
  return newline === -1 ? script.length : newline;
}

export const SHELLS = ["sh", "bash", "dash", "ksh", "zsh"];

type Heredoc = {
  readonly consumer: Command;
  readonly delimiter: string;
  readonly tabs: boolean;
  readonly literal: boolean;
};

type ShellParse = {
  readonly commands: string[][];
  readonly substitutions: string[];
  readonly heredocs: Heredoc[];
  words: string[];
  word: string | undefined;
  redirecting: boolean;
};

function endWord(parse: ShellParse): void {
  if (parse.word === undefined) return;
  if (!parse.redirecting) parse.words.push(parse.word);
  parse.redirecting = false;
  parse.word = undefined;
}

function endCommand(parse: ShellParse): void {
  endWord(parse);
  parse.commands.push(parse.words);
  parse.words = [];
  parse.redirecting = false;
}

function startRedirect(parse: ShellParse, script: string, index: number): number {
  if (parse.word !== undefined && FILE_DESCRIPTOR.test(parse.word)) parse.word = undefined;
  endWord(parse);
  const operator = REDIRECT_OPERATOR.exec(script.slice(index))?.[0] ?? script.charAt(index);
  if (operator === "<<") return startHeredoc(parse, script, index + operator.length);
  parse.redirecting = true;
  return index + operator.length;
}

function startHeredoc(parse: ShellParse, script: string, from: number): number {
  const tabs = script.charAt(from) === "-";
  let start = tabs ? from + 1 : from;
  while (WORD_BREAKS.has(script.charAt(start))) start += 1;
  let delimiter = "";
  let end = start;
  while (end < script.length && !DELIMITER_BREAKS.has(script.charAt(end))) {
    const part = shellPart(script, end);
    delimiter += part.text;
    end = part.end;
  }
  parse.heredocs.push({ consumer: parse.words, delimiter, tabs, literal: /['"\\]/.test(script.slice(start, end)) });
  return end;
}

function heredocBody(script: string, from: number, { delimiter, tabs }: Heredoc): Span {
  let line = from;
  while (line < script.length) {
    const lineEnd = commentEnd(script, line);
    const text = script.slice(line, lineEnd);
    if ((tabs ? text.replace(/^\t+/, "") : text) === delimiter) return { text: script.slice(from, line), end: lineEnd + 1 };
    line = lineEnd + 1;
  }
  return { text: script.slice(from), end: script.length };
}

function bodySubstitutions(body: string): readonly string[] {
  const substitutions: string[] = [];
  let index = 0;
  while (index < body.length) {
    const part = doubleQuotedPart(body, index);
    substitutions.push(...part.substitutions);
    index = part.end;
  }
  return substitutions;
}

function skipHeredocs(parse: ShellParse, script: string, from: number): number {
  let index = from;
  for (const heredoc of parse.heredocs.splice(0)) {
    const body = heredocBody(script, index, heredoc);
    const [program = ""] = fromProgram(heredoc.consumer);
    if (SHELLS.includes(program.slice(program.lastIndexOf("/") + 1))) parse.substitutions.push(body.text);
    else if (!heredoc.literal) parse.substitutions.push(...bodySubstitutions(body.text));
    index = body.end;
  }
  return index;
}

export function shellCommands(script: string): readonly Command[] {
  const parse: ShellParse = { commands: [], substitutions: [], heredocs: [], words: [], word: undefined, redirecting: false };
  let index = 0;
  while (index < script.length) {
    const char = script.charAt(index);
    if (char === "\\" && script.charAt(index + 1) === "\n") {
      index += 2;
    } else if (char === "#" && parse.word === undefined) {
      index = commentEnd(script, index);
    } else if (REDIRECTS.has(char)) {
      index = startRedirect(parse, script, index);
    } else if (COMMAND_BREAKS.has(char)) {
      endCommand(parse);
      index = char === "\n" ? skipHeredocs(parse, script, index + 1) : index + 1;
    } else if (WORD_BREAKS.has(char)) {
      endWord(parse);
      index += 1;
    } else {
      const part = shellPart(script, index);
      parse.word = (parse.word ?? "") + part.text;
      parse.substitutions.push(...part.substitutions);
      index = part.end;
    }
  }
  endCommand(parse);
  return [...parse.commands, ...parse.substitutions.flatMap(shellCommands)].filter((command) => command.length > 0);
}

export function withoutOptions(words: Command, operands: ReadonlySet<string>): Command {
  const [first = "", ...rest] = words;
  if (first === "--") return rest;
  if (!first.startsWith("-")) return words;
  return withoutOptions(operands.has(first) ? rest.slice(1) : rest, operands);
}

export function fromProgram(words: Command): Command {
  const [first = "", ...rest] = words;
  if (ASSIGNMENT.test(first) || RESERVED_WORDS.has(first)) return fromProgram(rest);
  const operands = LAUNCHER_OPERANDS.get(first);
  return operands === undefined ? words : fromProgram(withoutOptions(rest, operands));
}

// bun run resolves any other word, even one holding a slash, to a package.json script of that name first.
const FILE_PATH = /^\.{0,2}\//;

export function invokes(command: Command | undefined, gate: Command): boolean {
  if (command === undefined) return false;
  const begins = (words: Command) => gate.length <= words.length && gate.every((word, index) => words[index] === word);
  const bunRunsFile = command[0] === "bun" && command[1] === "run" && FILE_PATH.test(gate[0] ?? "");
  return begins(command) || (bunRunsFile && begins(command.slice(2)));
}

export function mentions(script: string, gate: Command): boolean {
  const tokens = script.split(/[\s|&;<>()`]+/);
  return tokens.some((_, start) => invokes(tokens.slice(start), gate));
}
