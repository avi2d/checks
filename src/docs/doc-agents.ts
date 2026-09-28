import { parseOutline } from "./doc-outline.ts";
import { commandNames, directoryOf, normalize, type Snapshot } from "./doc-references.ts";
import { AGENT_NAMES, scanMarkdown, type MarkdownLine } from "./prose-matchers.ts";

export const AGENT_CEILING = 3000;

const MAINTAINING = "Maintaining this file";
const LIST_ITEM = /^(?:\s*>)*\s*(?:[-*+]|\d{1,9}[.)])(?:\s|$)/;
const INLINE_LINK = /(?<![!\\])\[(?:[^[\]\\]|\\.|\[[^\]]*\])*\]\(\s*<?[^\s()<>]/g;

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

export function entries(text: string): readonly MarkdownLine[] {
  const outline = parseOutline(text);
  const kept = outline.sections.flatMap((section, index) =>
    section.heading.title === MAINTAINING ? [{ from: section.heading.line, to: outline.sections[index + 1]?.heading.line ?? Number.POSITIVE_INFINITY }] : [],
  );
  return scanMarkdown(text).filter(
    (line) => line.kind === "prose" && LIST_ITEM.test(line.prose) && !kept.some(({ from, to }) => line.line > from && line.line < to),
  );
}

type Tracked = Pick<Snapshot, "files" | "directories">;

function namesTrackedPath(agentFile: string, span: string, tracked: Tracked): boolean {
  const directory = directoryOf(agentFile);
  const fromRoot = span.startsWith("./") || span.startsWith("../") ? undefined : normalize(span);
  const fromFile = normalize(directory === "" ? span : `${directory}/${span}`);
  const namesDirectory = span.endsWith("/");
  return [fromRoot, fromFile].some((path) => path !== undefined && path !== "" && (tracked.directories.has(path) || (!namesDirectory && tracked.files.has(path))));
}

function namesLink({ raw, prose }: MarkdownLine): boolean {
  return [...raw.matchAll(INLINE_LINK)].some(({ index }) => prose.charAt(index) === "[");
}

function points(agentFile: string, line: MarkdownLine, tracked: Tracked): boolean {
  return line.code.some((span) => namesTrackedPath(agentFile, span, tracked)) || namesLink(line) || commandNames(line).length > 0;
}

export function entryFindings(agentFile: string, text: string, tracked: Tracked): readonly AgentFinding[] {
  return entries(text).flatMap((line) => {
    if (points(agentFile, line, tracked)) return [];
    return [
      {
        line: line.line,
        message: "names no tracked path, link or `bun run` command. Name the file, link or command that holds the detail",
      },
    ];
  });
}
