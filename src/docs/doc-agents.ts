import { parseOutline } from "./doc-outline.ts";
import { commandNames, isPathSpan } from "./doc-references.ts";
import { AGENT_NAMES, scanMarkdown, type MarkdownLine } from "./prose-matchers.ts";

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

export function topicBullets(text: string): readonly number[] {
  const outline = parseOutline(text);
  return outline.sections.flatMap((section, index) => {
    if (section.heading.title === MAINTAINING) return [];
    const end = outline.sections[index + 1]?.heading.line ?? Number.POSITIVE_INFINITY;
    return outline.prose
      .filter((line) => line.line > section.heading.line && line.line < end && LIST_ITEM.test(line.text))
      .map((line) => line.line);
  });
}

function namesReference(line: MarkdownLine | undefined, commands: boolean): boolean {
  if (line === undefined || line.kind === "code" || line.kind === "front-matter") return true;
  return line.code.some(isPathSpan) || line.links.length > 0 || (commands && commandNames(line).length > 0);
}

export function entryFindings(text: string, changed: ReadonlySet<number>, commands: boolean): readonly AgentFinding[] {
  const bullets = topicBullets(text);
  if (bullets.length === 0) return [];
  const scanned = new Map(scanMarkdown(text).map((line) => [line.line, line]));
  return bullets.flatMap((line) => {
    if (!changed.has(line) || namesReference(scanned.get(line), commands)) return [];
    return [
      {
        line,
        message: "names no path, link or command that resolves. Name the file, link or command that holds the detail",
      },
    ];
  });
}
