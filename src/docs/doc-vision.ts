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
  const lines = text.split("\n");
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
const HEADING = /^ {0,3}#{1,6}(?:\s|$)/;
const LIST_MARKER = /^ {0,3}(?:[-*+]|\d+[.)])\s+/;
const QUOTE_MARKER = /^ {0,3}>\s?/;
const BOLD_LABEL = /^\*\*[^*]+\*\*\s+/;

function sentenceOf(raw: string): string {
  return raw
    .replace(QUOTE_MARKER, "")
    .replace(LIST_MARKER, "")
    .replace(BOLD_LABEL, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
};

function sentencesOf(text: string): readonly { readonly line: number; readonly sentence: string }[] {
  const found: { readonly line: number; readonly sentence: string }[] = [];
  let fence: string | undefined;
  text.split("\n").forEach((raw, index) => {
    const fenceMatch = FENCE.exec(raw)?.[1];
    if (fence !== undefined) {
      if (fenceMatch !== undefined && fenceMatch[0] === fence[0] && fenceMatch.length >= fence.length) fence = undefined;
      return;
    }
    if (fenceMatch !== undefined) {
      fence = fenceMatch;
      return;
    }
    if (raw.trim() === "" || HEADING.test(raw)) return;
    const sentence = sentenceOf(raw);
    if (sentence !== "") found.push({ line: index + 1, sentence });
  });
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
