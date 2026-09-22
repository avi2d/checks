export type Comment = { line: number; text: string };

type Marker = { readonly token: string; readonly afterAWordBreak: boolean };
type Quote = { readonly token: string; readonly backslashEscapes: boolean; readonly opensMidWord: boolean };

type Syntax = {
  readonly line: readonly Marker[];
  readonly block: readonly (readonly [open: string, close: string])[];
  readonly quotes: readonly Quote[];
  readonly regexLiterals: boolean;
};

const anywhere = (token: string): Marker => ({ token, afterAWordBreak: false });
const startingAWord = (token: string): Marker => ({ token, afterAWordBreak: true });
const escaping = (token: string): Quote => ({ token, backslashEscapes: true, opensMidWord: true });
const literal = (token: string): Quote => ({ token, backslashEscapes: false, opensMidWord: true });
const outsideAWord = (quote: Quote): Quote => ({ ...quote, opensMidWord: false });

const SLASHES: readonly (readonly [string, string])[] = [["/*", "*/"]];
const SLASH_SLASH = [startingAWord("//")];
const DASHES = [anywhere("--")];
const STRINGS = [escaping('"'), escaping("'")];

const JS: Syntax = {
  line: SLASH_SLASH,
  block: SLASHES,
  quotes: [escaping('"'), outsideAWord(escaping("'")), escaping("`")],
  regexLiterals: true,
};
const CURLY: Syntax = { ...JS, quotes: [...STRINGS, escaping("`")], regexLiterals: false };
const PHP: Syntax = { line: [...SLASH_SLASH, anywhere("#")], block: SLASHES, quotes: STRINGS, regexLiterals: false };
const HASH: Syntax = {
  line: [startingAWord("#")],
  block: [],
  quotes: [escaping('"'), literal("'")],
  regexLiterals: false,
};
const YAML: Syntax = { ...HASH, quotes: [escaping('"'), outsideAWord(literal("'"))] };
const SQL: Syntax = { line: DASHES, block: SLASHES, quotes: STRINGS, regexLiterals: false };
const LUA: Syntax = { line: DASHES, block: [["--[[", "]]"]], quotes: STRINGS, regexLiterals: false };
const HASKELL: Syntax = { line: DASHES, block: [["{-", "-}"]], quotes: [escaping('"')], regexLiterals: false };
const ML: Syntax = { line: [], block: [["(*", "*)"]], quotes: [escaping('"')], regexLiterals: false };

export const SYNTAXES: Readonly<Record<string, Syntax>> = {
  ts: JS,
  tsx: JS,
  mts: JS,
  cts: JS,
  js: JS,
  jsx: JS,
  mjs: JS,
  cjs: JS,
  go: CURLY,
  rs: CURLY,
  java: CURLY,
  kt: CURLY,
  swift: CURLY,
  scala: CURLY,
  c: CURLY,
  h: CURLY,
  cc: CURLY,
  cpp: CURLY,
  hpp: CURLY,
  cs: CURLY,
  php: PHP,
  py: HASH,
  rb: HASH,
  ex: HASH,
  exs: HASH,
  sh: HASH,
  bash: HASH,
  zsh: HASH,
  nix: HASH,
  sql: SQL,
  lua: LUA,
  hs: HASKELL,
  yaml: YAML,
  yml: YAML,
  toml: HASH,
  ml: ML,
};

export function syntaxFor(path: string): Syntax {
  const extension = path.slice(path.lastIndexOf(".") + 1);
  const syntax = SYNTAXES[extension];
  if (!syntax) {
    throw new Error(
      `${path} is code the comment checks cannot read: add a comment syntax for .${extension} to scripts/comments.ts`,
    );
  }
  return syntax;
}

const WORD = /[\w$]/;

const KEYWORDS = new Set([
  "return",
  "typeof",
  "instanceof",
  "in",
  "of",
  "new",
  "delete",
  "void",
  "throw",
  "case",
  "do",
  "else",
  "yield",
  "await",
]);

const AFTER_A_VALUE = /[)\]}"'`]/;

function opensRegex(previous: string): boolean {
  if (previous === "") return true;
  if (WORD.test(previous[0]!)) return KEYWORDS.has(previous);
  return !AFTER_A_VALUE.test(previous);
}

const WORD_BREAK = /[\s;|&(]/;

function endOfQuoted(source: string, start: number, quote: Quote): number {
  let i = start + quote.token.length;
  while (i < source.length) {
    if (quote.backslashEscapes && source[i] === "\\") i += 2;
    else if (source.startsWith(quote.token, i)) return i + quote.token.length;
    else i += 1;
  }
  return start + quote.token.length;
}

function endOfRegex(source: string, start: number): number {
  let i = start + 1;
  let inClass = false;
  while (i < source.length) {
    const char = source[i]!;
    if (char === "\\") i += 2;
    else if (char === "\n") return i;
    else {
      if (char === "[") inClass = true;
      else if (char === "]") inClass = false;
      else if (char === "/" && !inClass) return i + 1;
      i += 1;
    }
  }
  return source.length;
}

export function comments(path: string, source: string): Comment[] {
  const syntax = syntaxFor(path);
  const found: Comment[] = [];
  let i = 0;
  let line = 1;
  let previous = "";

  const advance = (to: number): void => {
    for (let k = i; k < to; k++) if (source[k] === "\n") line += 1;
    i = to;
  };

  while (i < source.length) {
    const char = source[i]!;

    const block = syntax.block.find(([open]) => source.startsWith(open, i));
    if (block) {
      const [open, close] = block;
      const closed = source.indexOf(close, i + open.length);
      const stop = closed < 0 ? source.length : closed + close.length;
      found.push({ line, text: source.slice(i, stop) });
      advance(stop);
      previous = "";
      continue;
    }

    const marker = syntax.line.find(
      ({ token, afterAWordBreak }) =>
        source.startsWith(token, i) && (!afterAWordBreak || i === 0 || WORD_BREAK.test(source[i - 1]!)),
    );
    if (marker) {
      const newline = source.indexOf("\n", i);
      const stop = newline < 0 ? source.length : newline;
      found.push({ line, text: source.slice(i, stop) });
      advance(stop);
      previous = "";
      continue;
    }

    const quote = syntax.quotes.find(
      ({ token, opensMidWord }) =>
        source.startsWith(token, i) && (opensMidWord || i === 0 || !WORD.test(source[i - 1]!)),
    );
    if (quote) {
      advance(endOfQuoted(source, i, quote));
      previous = quote.token;
      continue;
    }

    if (syntax.regexLiterals && char === "/" && opensRegex(previous)) {
      advance(endOfRegex(source, i));
      previous = "/";
      continue;
    }

    if (WORD.test(char)) {
      let end = i;
      while (end < source.length && WORD.test(source[end]!)) end += 1;
      previous = source.slice(i, end);
      advance(end);
      continue;
    }

    if (!/\s/.test(char)) previous = char;
    advance(i + 1);
  }

  return found;
}

const LICENCE = /copyright|spdx-license-identifier|all rights reserved|licen[cs]ed under|permission is hereby granted/i;

// A single sentence wraps to at most a few lines at a normal width, so a longer run at the
// file's own opening is the shape of a paragraph rather than of one fact.
const A_WRAPPED_SENTENCE_FITS_WITHIN = 3;

function beginsItsLine(comment: Comment, lines: readonly string[]): boolean {
  return lines[comment.line - 1]!.trimStart().startsWith(comment.text.split("\n")[0]!);
}

function openingBlock(found: readonly Comment[], source: string): Comment[] {
  const lines = source.split("\n");
  if (found.length === 0 || found[0]!.line !== 1 || !beginsItsLine(found[0]!, lines)) return [];
  const block = [found[0]!];
  let next = found[0]!.line + found[0]!.text.split("\n").length;
  for (let i = 1; i < found.length && found[i]!.line === next && beginsItsLine(found[i]!, lines); i++) {
    block.push(found[i]!);
    next = found[i]!.line + found[i]!.text.split("\n").length;
  }
  return block;
}

type Check = {
  readonly find: RegExp;
  readonly refusal: (match: string) => string;
};

const CHECKS: readonly Check[] = [
  {
    find: /@ts-expect-error|@ts-ignore|\bprettier-ignore\b|\beslint-disable[\w-]*|\bbiome-ignore\b/,
    refusal: (match) =>
      `carries the machine-read directive \`${match}\`. Fix what the tool is reporting, or stop running the tool on this file`,
  },
  {
    find: /\bADR[\s-]?\d+|\bdocs\/adr\b|\bRFC[\s-]?\d+|(?:^|[\s(["'`])#\d+\b|[\w.-]+\/[\w.-]+#\d+|\/(?:issues|pull)\/\d+/i,
    refusal: (match) =>
      `points at a record or a ticket (${JSON.stringify(match.trim())}). Drop the pointer: a record is reached by searching docs/adr, and the story of the change goes in the commit message`,
  },
  {
    find: /^\/\*\*/,
    refusal: () =>
      "opens a doc block. Make the code say it, or put what the types cannot hold on a line comment in the fewest words that carry it",
  },
];

function spans(from: number, lineCount: number, within: ReadonlySet<number> | undefined): boolean {
  if (within === undefined) return true;
  for (let line = from; line < from + lineCount; line += 1) if (within.has(line)) return true;
  return false;
}

export function refused(path: string, source: string, within?: ReadonlySet<number>): string[] {
  const out: string[] = [];
  const found = comments(path, source);

  const opening = openingBlock(found, source);
  const openingText = opening.map((comment) => comment.text).join("\n");
  const openingLines = opening.reduce((sum, comment) => sum + comment.text.split("\n").length, 0);
  if (
    opening.length > 0 &&
    openingLines > A_WRAPPED_SENTENCE_FITS_WITHIN &&
    !LICENCE.test(openingText) &&
    spans(1, openingLines, within)
  ) {
    out.push(
      `${path}:1 opens with a ${openingLines}-line rationale block. A record this long belongs in docs/adr or the repo's decision log, and the code does not point at it`,
    );
  }

  for (const comment of found) {
    if (LICENCE.test(comment.text)) continue;
    if (!spans(comment.line, comment.text.split("\n").length, within)) continue;
    for (const check of CHECKS) {
      const [match] = check.find.exec(comment.text) ?? [];
      if (match !== undefined) out.push(`${path}:${comment.line} ${check.refusal(match)}`);
    }
  }
  return out;
}
