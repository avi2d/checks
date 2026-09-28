import { parseOutline } from "./doc-outline.ts";
import { referencesOn, type Judging, type Reference, type Snapshot, type Unresolved } from "./doc-references.ts";
import { AGENT_NAMES, scanMarkdown } from "./prose-matchers.ts";

export const AGENT_CEILING = 3000;

const MAINTAINING = "Maintaining this file";
const LIST_ITEM = /^(?:\s*>)*\s*(?:[-*+]|\d{1,9}[.)])(?:\s|$)/;

export type AgentFinding = {
  readonly line: number | undefined;
  readonly message: string;
};

export function isAgentFile(repositoryPath: string): boolean {
  return AGENT_NAMES.includes(repositoryPath.slice(repositoryPath.lastIndexOf("/") + 1));
}

export function ceilingFinding(text: string): AgentFinding | undefined {
  if (text.length <= AGENT_CEILING) return undefined;
  return {
    line: undefined,
    message: `is ${text.length} characters, over the 3,000-character ceiling for agent files. Keep what nearly every session needs plus one pointer per part, move each part's notes into the people doc that covers that part, and delete what a check already holds`,
  };
}

export function entryLines(text: string): readonly number[] {
  const outline = parseOutline(text);
  const kept = outline.sections.flatMap((section, index) =>
    section.heading.title === MAINTAINING ? [{ from: section.heading.line, to: outline.sections[index + 1]?.heading.line ?? Number.POSITIVE_INFINITY }] : [],
  );
  return outline.prose
    .filter((line) => LIST_ITEM.test(line.text) && !kept.some(({ from, to }) => line.line > from && line.line < to))
    .map((line) => line.line);
}

export function entryFindings(
  path: string,
  text: string,
  snapshot: Snapshot,
  judging: Judging,
  stillBroken: (unresolved: Unresolved) => boolean,
): readonly AgentFinding[] {
  const scanned = new Map(scanMarkdown(text).map((line) => [line.line, line]));
  const points = (reference: Reference): boolean => reference === "resolved" || !stillBroken(reference);
  return entryLines(text).flatMap((line) => {
    const markdown = scanned.get(line);
    if (markdown === undefined || markdown.kind === "code" || markdown.kind === "front-matter" || referencesOn(path, markdown, snapshot, judging).some(points)) return [];
    return [
      {
        line,
        message: "names no path, link or command that resolves. Name the file, link or command that holds the detail",
      },
    ];
  });
}
