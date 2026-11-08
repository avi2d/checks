import { VISION_PAGE } from "./doc-templates.ts";
import { continues, scanMarkdown, type MarkdownLine } from "./prose-matchers.ts";

export type VisionViolation = {
  readonly line: number;
  readonly message: string;
};

const VISION_REPOS: readonly string[] = ["skills", "checks", "workflows", "orc"];

export function shortName(manifestName: string): string {
  return manifestName.slice(manifestName.lastIndexOf("/") + 1);
};

export function requiresName(value: unknown): boolean {
  if (typeof value !== "object" || value === null || !("name" in value)) return false;
  const name: unknown = value.name;
  if (typeof name !== "string") return false;
  return VISION_REPOS.includes(shortName(name));
};

const ALIGNS = /^ {0,3}A change aligns when\s+\S/;
const RESISTED = /^ {0,3}A change should be resisted when\s+\S/;

export function shapeFindings(text: string): readonly VisionViolation[] {
  const lines: string[] = [];
  let fence: string | undefined;
  for (const raw of text.split("\n")) {
    const fenceMatch = FENCE.exec(raw)?.[1];
    if (fence !== undefined) {
      if (fenceMatch !== undefined && fenceMatch[0] === fence[0] && fenceMatch.length >= fence.length) fence = undefined;
      continue;
    }
    if (fenceMatch !== undefined) {
      fence = fenceMatch;
      continue;
    }
    lines.push(raw);
  }
  const findings: VisionViolation[] = [];
  if (!lines.some((line) => ALIGNS.test(line))) {
    findings.push({ line: 1, message: "lacks an `A change aligns when ...` closing line" });
  }
  if (!lines.some((line) => RESISTED.test(line))) {
    findings.push({ line: 1, message: "lacks an `A change should be resisted when ...` closing line" });
  }
  return findings;
};

const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const INDENTED_CODE = /^(?: {4,}|\t)/;
const LIST_MARKER = /^\s*(?:[-*+]|\d{1,9}[.)])\s+/;
const QUOTE_MARKER = /^\s*(?:>\s*)+/;
const AUTOLINK = /<([A-Za-z][A-Za-z0-9+.-]{1,31}:[^\s<>]*|[^\s@<>]+@[^\s<>]+)>/g;
const DELIMITER_CELL = /^:?-+:?$/;
const CLOSERS: ReadonlySet<string> = new Set(["'", '"', "\u201d", "\u2019", "\u00bb", ")", "]"]);

function stashCode(text: string, codes: string[]): string {
  let out = "";
  let at = 0;
  while (at < text.length) {
    const open = text.indexOf("`", at);
    if (open === -1) {
      out += text.slice(at);
      break;
    }
    let run = 0;
    while (text[open + run] === "`") run += 1;
    let close = -1;
    let scan = open + run;
    while (scan < text.length) {
      const tick = text.indexOf("`", scan);
      if (tick === -1) break;
      let length = 0;
      while (text[tick + length] === "`") length += 1;
      if (length === run) {
        close = tick;
        break;
      }
      scan = tick + length;
    }
    if (close === -1) {
      out += text.slice(at);
      break;
    }
    out += text.slice(at, open);
    codes.push(text.slice(open + run, close).trim());
    out += "\x00" + String(codes.length - 1) + "\x00";
    at = close + run;
  }
  return out;
};

function textOf(raw: string): string {
  const codes: string[] = [];
  const unlisted = stashCode(raw, codes).replace(QUOTE_MARKER, "").replace(LIST_MARKER, "");
  return unlisted
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]/g, "$1")
    .replace(AUTOLINK, "$1")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/\*\*([^*]*)\*\*/g, "$1")
    .replace(/__([^_]*)__/g, "$1")
    .replace(/(^|\W)\*([^\*\n]+)\*(?=\W|$)/g, "$1$2")
    .replace(/(^|\W)_([^_\n]+)_(?=\W|$)/g, "$1$2")
    .replace(/~~([^~]*)~~/g, "$1")
    .replace(/<[^>]*>/g, " ")
    .replace(/\x00(\d+)\x00/g, (_match: string, index: string) => codes[Number(index)] ?? "");
};

const ABBREVIATION = /\b(?:e\.g|i\.e|etc|vs|cf|approx|mr|mrs|ms|dr|st|no|fig)$/i;

function terminated(fragment: string): boolean {
  let end = fragment.length;
  while (end > 0 && CLOSERS.has(fragment[end - 1] ?? "")) end -= 1;
  const char = end > 0 ? fragment[end - 1] ?? "" : "";
  return char === "." || char === "!" || char === "?";
};

function isIndentedCode(index: number, lines: readonly MarkdownLine[]): boolean {
  const line = lines[index];
  if (line === undefined || line.kind !== "prose" || !INDENTED_CODE.test(line.raw)) return false;
  let at = index - 1;
  while (at >= 0 && lines[at]?.kind === "prose" && INDENTED_CODE.test(lines[at]?.raw ?? "")) at -= 1;
  const head = at >= 0 ? lines[at] : undefined;
  return head?.kind !== "prose";
};

function isDelimiterRow(raw: string): boolean {
  const cells = raw.split("|").map((cell) => cell.trim());
  return cells.some((cell) => cell !== "") && cells.every((cell) => cell === "" || DELIMITER_CELL.test(cell));
};

function cellsOf(raw: string): readonly string[] {
  if (isDelimiterRow(raw)) return [];
  return raw.split("|").map((cell) => textOf(cell));
};

function normalize(sentence: string): string {
  return sentence.toLowerCase().replace(/\s+/g, " ").trim();
};

function sentenceBounds(clean: string): readonly { readonly start: number; readonly end: number }[] {
  const bounds: { readonly start: number; readonly end: number }[] = [];
  let start = 0;
  let at = 0;
  while (at < clean.length) {
    const char = clean[at] ?? "";
    if (char === "." || char === "!" || char === "?") {
      let end = at + 1;
      while (end < clean.length && CLOSERS.has(clean[end] ?? "")) end += 1;
      const next = end >= clean.length ? "" : clean[end] ?? "";
      if ((end >= clean.length || /\s/.test(next)) && !(end < clean.length && ABBREVIATION.test(clean.slice(start, at)))) {
        bounds.push({ start, end });
        while (end < clean.length && /\s/.test(clean[end] ?? "")) end += 1;
        start = end;
        at = end;
        continue;
      }
    }
    at += 1;
  }
  if (start < clean.length) bounds.push({ start, end: clean.length });
  return bounds;
};

function emitSentences(clean: string, line: number, found: { readonly line: number; readonly sentence: string }[]): void {
  if (clean.trim() === "") return;
  for (const { start, end } of sentenceBounds(clean)) {
    const fragment = clean.slice(start, end);
    if (!terminated(fragment)) continue;
    const sentence = normalize(fragment);
    if (sentence !== "") found.push({ line, sentence });
  }
};

function sentencesOf(text: string): readonly { readonly line: number; readonly sentence: string }[] {
  const found: { readonly line: number; readonly sentence: string }[] = [];
  const lines = scanMarkdown(text);
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (line === undefined) break;
    if (line.kind === "table") {
      const next = lines[index + 1];
      if (next?.kind !== "table" || !isDelimiterRow(next.raw)) {
        for (const cell of cellsOf(line.raw)) emitSentences(cell, line.line, found);
      }
      index += 1;
      continue;
    }
    if (line.kind !== "prose" || isIndentedCode(index, lines)) {
      index += 1;
      continue;
    }
    const block: MarkdownLine[] = [line];
    let following = lines[index + 1];
    while (following !== undefined && following.kind === "prose" && !isIndentedCode(index + 1, lines) && continues(lines[index], following)) {
      block.push(following);
      index += 1;
      following = lines[index + 1];
    }
    const texts = block.map((one) => textOf(one.raw));
    const starts: number[] = [];
    let at = 0;
    for (const one of texts) {
      starts.push(at);
      at += one.length + 1;
    }
    const joined = texts.join(" ");
    if (joined.trim() !== "") {
      for (const { start, end } of sentenceBounds(joined)) {
        const sentence = normalize(joined.slice(start, end));
        if (sentence === "") continue;
        let owner = 0;
        for (let i = 0; i < starts.length; i += 1) {
          if ((starts[i] ?? 0) <= start) owner = i;
        }
        found.push({ line: block[owner]?.line ?? line.line, sentence });
      }
    }
    index += 1;
  }
  return found;
};

export type VisionPageFinding = {
  readonly path: string;
  readonly line: number | undefined;
  readonly message: string;
};

const TRIO_PAGES: readonly string[] = ["README.md", "AGENTS.md", VISION_PAGE];

export function trioFindings(pages: ReadonlyMap<string, string>): readonly VisionPageFinding[] {
  return TRIO_PAGES.flatMap((path) => {
    const page = pages.get(path);
    if (page === undefined) return [];
    const others = TRIO_PAGES.filter((other) => other !== path).flatMap((other) => {
      const otherText = pages.get(other);
      return otherText === undefined ? [] : [{ path: other, text: otherText }];
    });
    return repeatedVisionFindings(page, others).map(({ line, message }) => ({ path, line, message }));
  });
};

export function visionPools(
  templated: readonly VisionPageFinding[],
  pages: ReadonlyMap<string, string>,
): { readonly vision: readonly VisionPageFinding[]; readonly template: readonly VisionPageFinding[] } {
  const repeated = trioFindings(pages);
  return {
    vision: [...templated.filter(({ path }) => path === VISION_PAGE), ...repeated.filter(({ path }) => path === VISION_PAGE)],
    template: [...templated.filter(({ path }) => path !== VISION_PAGE), ...repeated.filter(({ path }) => path !== VISION_PAGE)],
  };
};

export function repeatedVisionFindings(
  visionText: string,
  others: readonly { readonly path: string; readonly text: string }[],
): readonly VisionViolation[] {
  const known = new Map<string, { readonly path: string; readonly sentence: string }>();
  for (const { path, text } of others) {
    for (const { sentence } of sentencesOf(text)) {
      if (!known.has(sentence)) known.set(sentence, { path, sentence });
    }
  }
  return sentencesOf(visionText).flatMap(({ line, sentence }): readonly VisionViolation[] => {
    const match = known.get(sentence);
    if (match === undefined) return [];
    return [{ line, message: "repeats a sentence from " + match.path + ": \"" + sentence + "\"" }];
  });
};
