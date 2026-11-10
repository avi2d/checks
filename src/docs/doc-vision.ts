import { VISION_PAGE } from "./doc-templates.ts";

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
      if (fenceCloses(raw, fence)) fence = undefined;
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

function fenceCloses(raw: string, opener: string): boolean {
  const closer = FENCE.exec(raw)?.[1];
  return closer !== undefined && closer[0] === opener[0] && closer.length >= opener.length && raw.trim() === closer;
};
const HEADING = /^ {0,3}#{1,6}(?:\s|$)/;
const INDENTED_CODE = /^(?: {4,}|\t)/;
const BREAK = /^(?:\*{3,}|-{3,}|_{3,}|=+)\s*$/;
const FRONT_OPEN = /^---\s*$/;
const FRONT_CLOSE = /^(?:---|\.\.\.)\s*$/;
const COMMENT_OPEN = /<!--/;
const COMMENT_CLOSE = /-->/;
const DELIMITER_CELL = /^:?-+:?$/;

function isDelimiterRow(raw: string): boolean {
  const cells = raw.split("|").map((cell) => cell.trim());
  return cells.some((cell) => cell !== "") && cells.every((cell) => cell === "" || DELIMITER_CELL.test(cell));
};

function tableLines(raws: readonly string[]): ReadonlySet<number> {
  const blocked = new Set<number>();
  for (let at = 0; at < raws.length; at += 1) {
    if (!isDelimiterRow(raws[at] ?? "")) continue;
    let start = at;
    while (start - 1 >= 0 && (raws[start - 1] ?? "").includes("|")) start -= 1;
    let end = at;
    while (end + 1 < raws.length && (raws[end + 1] ?? "").includes("|")) end += 1;
    for (let line = start; line <= end; line += 1) blocked.add(line);
  }
  return blocked;
};

function normalizeLine(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
};

type ScanState = {
  fence: string | undefined;
  front: boolean;
  comment: boolean;
};

function startScan(first: string | undefined): ScanState {
  return { fence: undefined, front: first !== undefined && FRONT_OPEN.test(first), comment: false };
};

function trackFront(raw: string, at: number, state: ScanState): boolean {
  if (!state.front) return false;
  if (at > 0 && FRONT_CLOSE.test(raw)) state.front = false;
  return true;
};

function trackFence(raw: string, state: ScanState): boolean {
  if (state.fence !== undefined) {
    if (fenceCloses(raw, state.fence)) state.fence = undefined;
    return true;
  }
  const fenceMatch = FENCE.exec(raw)?.[1];
  if (fenceMatch === undefined) return false;
  state.fence = fenceMatch;
  return true;
};

function trackComment(raw: string, state: ScanState): boolean {
  if (state.comment) {
    if (COMMENT_CLOSE.test(raw)) state.comment = false;
    return true;
  }
  if (!COMMENT_OPEN.test(raw)) return false;
  if (!COMMENT_CLOSE.test(raw)) state.comment = true;
  return true;
};

function blockedLine(raw: string, at: number, tables: ReadonlySet<number>): boolean {
  return HEADING.test(raw) || INDENTED_CODE.test(raw) || BREAK.test(raw) || tables.has(at);
};

function comparableLines(text: string): readonly { readonly line: number; readonly text: string }[] {
  const raws = text.split("\n");
  const tables = tableLines(raws);
  const found: { readonly line: number; readonly text: string }[] = [];
  const state = startScan(raws[0]);
  for (let at = 0; at < raws.length; at += 1) {
    const raw = raws[at] ?? "";
    if (trackFront(raw, at, state)) continue;
    if (trackFence(raw, state)) continue;
    if (trackComment(raw, state)) continue;
    if (blockedLine(raw, at, tables)) continue;
    const line = normalizeLine(raw);
    if (line === "") continue;
    found.push({ line: at + 1, text: line });
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
  const known = new Map<string, string>();
  for (const { path, text } of others) {
    for (const { text: line } of comparableLines(text)) {
      if (!known.has(line)) known.set(line, path);
    }
  }
  return comparableLines(visionText).flatMap(({ line, text }): readonly VisionViolation[] => {
    const match = known.get(text);
    if (match === undefined) return [];
    return [{ line, message: "repeats a line from " + match + ": \"" + text + "\"" }];
  });
};
