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

const COMMAND_BREAKS = new Set(["\n", ";", "&", "|", "(", ")", "`"]);
const WORD_BREAKS = new Set([" ", "\t", "<", ">"]);
const DOUBLE_QUOTE_ESCAPES = new Set(["$", "`", '"', "\\"]);

function shellDoubleQuoted(script: string, open: number): Span {
  let text = "";
  let index = open + 1;
  while (index < script.length && script.charAt(index) !== '"') {
    const next = script.charAt(index + 1);
    if (script.charAt(index) === "\\" && next === "\n") {
      index += 2;
    } else if (script.charAt(index) === "\\" && DOUBLE_QUOTE_ESCAPES.has(next)) {
      text += next;
      index += 2;
    } else {
      text += script.charAt(index);
      index += 1;
    }
  }
  return { text, end: index + 1 };
}

function shellPart(script: string, index: number): Span {
  const char = script.charAt(index);
  if (char === "'") {
    const close = script.indexOf("'", index + 1);
    const end = close === -1 ? script.length : close;
    return { text: script.slice(index + 1, end), end: end + 1 };
  }
  if (char === '"') return shellDoubleQuoted(script, index);
  if (char === "\\") return { text: script.charAt(index + 1), end: index + 2 };
  return { text: char, end: index + 1 };
}

function commentEnd(script: string, from: number): number {
  const newline = script.indexOf("\n", from);
  return newline === -1 ? script.length : newline;
}

export function shellCommands(script: string): readonly Command[] {
  const commands: string[][] = [];
  let words: string[] = [];
  let word: string | undefined;
  const endWord = () => {
    if (word !== undefined) words.push(word);
    word = undefined;
  };
  let index = 0;
  while (index < script.length) {
    const char = script.charAt(index);
    if (char === "\\" && script.charAt(index + 1) === "\n") {
      index += 2;
    } else if (char === "#" && word === undefined) {
      index = commentEnd(script, index);
    } else if (WORD_BREAKS.has(char) || COMMAND_BREAKS.has(char)) {
      endWord();
      if (COMMAND_BREAKS.has(char)) {
        commands.push(words);
        words = [];
      }
      index += 1;
    } else {
      const part = shellPart(script, index);
      word = (word ?? "") + part.text;
      index = part.end;
    }
  }
  endWord();
  return [...commands, words].filter((command) => command.length > 0);
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
