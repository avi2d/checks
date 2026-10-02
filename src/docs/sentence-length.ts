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

function graphemesOf(body: string): readonly string[] {
  return [...new Intl.Segmenter().segment(body)].map(({ segment }) => segment);
}

function dropPrefix(raw: string): string {
  const chars = graphemesOf(raw);
  for (const [at, char] of chars.entries()) {
    if (char !== " " && char !== "\t" && char !== ">") return chars.slice(at).join("");
  }
  return "";
}

function orderedAt(raw: string): boolean {
  const rest = dropPrefix(raw);
  const digits = /^\d+/.exec(rest)?.[0] ?? "";
  if (digits === "") return false;
  const marker = rest.charAt(digits.length);
  if (marker !== "." && marker !== ")") return false;
  const after = rest.charAt(digits.length + 1);
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
  const chars = graphemesOf(body);
  const sentences: string[] = [];
  let start = 0;
  let cut = -1;
  for (const [at, char] of chars.entries()) {
    if (char === "." || char === "!" || char === "?") cut = at + 1;
    else if (cut === at && isCloser(char)) cut = at + 1;
    else if (cut > start && (char === " " || char === "\t")) {
      sentences.push(chars.slice(start, cut).join(""));
      start = cut;
      cut = -1;
    } else if (cut > start) cut = -1;
  }
  if (cut === chars.length && cut > start) {
    sentences.push(chars.slice(start, cut).join(""));
    start = cut;
  }
  const tail = chars.slice(start).join("");
  if (tail.trim() !== "") sentences.push(tail);
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
