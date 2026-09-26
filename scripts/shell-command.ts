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
