import { bodyOf, scanMarkdown } from "./prose-matchers.ts";

export const PROCEDURAL_WORD_CAP = 20;
export const DESCRIPTIVE_WORD_CAP = 25;

export type SentenceKind = "procedural" | "descriptive";

export type SentenceLength = {
  readonly line: number;
  readonly words: number;
  readonly kind: SentenceKind;
};

export type LongSentence = SentenceLength & {
  readonly message: string;
};

function orderedAt(raw: string): boolean {
  let at = 0;
  while (raw.charAt(at) === " " || raw.charAt(at) === "\t" || raw.charAt(at) === ">") at += 1;
  const digits = at;
  while (raw.charAt(at) >= "0" && raw.charAt(at) <= "9") at += 1;
  if (at === digits) return false;
  const marker = raw.charAt(at);
  if (marker !== "." && marker !== ")") return false;
  const after = raw.charAt(at + 1);
  return after === " " || after === "\t" || after === "";
}

function isWordChar(char: string): boolean {
  return (char >= "0" && char <= "9") || (char >= "A" && char <= "Z") || (char >= "a" && char <= "z");
}

function wordsIn(sentence: string): number {
  let words = 0;
  let inToken = false;
  let holdsWordChar = false;
  for (const char of sentence) {
    if (char === " " || char === "\t") {
      if (inToken && holdsWordChar) words += 1;
      inToken = false;
      holdsWordChar = false;
    } else {
      inToken = true;
      if (isWordChar(char)) holdsWordChar = true;
    }
  }
  return inToken && holdsWordChar ? words + 1 : words;
}

function isCloser(char: string): boolean {
  return char === '"' || char === "'" || char === ")" || char === "]" || char === "*" || char === "_" || char === "”" || char === "’";
}

function sentencesIn(body: string): readonly string[] {
  const sentences: string[] = [];
  let start = 0;
  let at = 0;
  while (at < body.length) {
    const char = body.charAt(at);
    if (char === "." || char === "!" || char === "?") {
      let end = at + 1;
      while (isCloser(body.charAt(end))) end += 1;
      const next = body.charAt(end);
      if (next === "" || next === " " || next === "\t") {
        sentences.push(body.slice(start, end));
        start = end;
      }
    }
    at += 1;
  }
  if (body.slice(start).trim() !== "") sentences.push(body.slice(start));
  return sentences;
}

export function sentenceLengths(text: string, within?: ReadonlySet<number>): readonly SentenceLength[] {
  return scanMarkdown(text).flatMap((line) => {
    if (line.kind !== "prose" || (within !== undefined && !within.has(line.line))) return [];
    const kind: SentenceKind = orderedAt(line.raw) ? "procedural" : "descriptive";
    return sentencesIn(bodyOf(line)).map((sentence) => ({ line: line.line, words: wordsIn(sentence), kind }));
  });
}

export function longSentences(text: string, within?: ReadonlySet<number>): readonly LongSentence[] {
  return sentenceLengths(text, within).flatMap(({ line, words, kind }) => {
    const cap = kind === "procedural" ? PROCEDURAL_WORD_CAP : DESCRIPTIVE_WORD_CAP;
    if (words <= cap) return [];
    const rule =
      kind === "procedural"
        ? `procedural means an ordered list item; descriptive caps at ${DESCRIPTIVE_WORD_CAP} words`
        : `procedural means an ordered list item, capped at ${PROCEDURAL_WORD_CAP} words`;
    return [{ line, words, kind, message: `carries a ${words}-word ${kind} sentence, over the ${cap}-word cap (${rule})` }];
  });
}
