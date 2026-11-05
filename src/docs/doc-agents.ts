import { Parser, type NodeType } from "commonmark";
import { commandNames, type Snapshot } from "./doc-references.ts";
import { handWritten } from "./doc-versions.ts";
import { AGENT_NAMES, scanMarkdown, type MarkdownLine } from "./prose-matchers.ts";

export const AGENT_CEILING = 3000;
export const README_CEILING = 6000;
export const CELL_CEILING = 300;

const README = "README.md";
const MANIFEST = "package.json";
const SECOND_LEVEL = /^\s{0,3}##(?:\s+|$)(.*?)(?:\s+#+)?\s*$/;
const SETEXT_SECOND = /^\s{0,3}-+\s*$/;
const CELL_SEPARATOR = /(?<!\\)\|/;
const ROW_EDGES = /^\||(?<!\\)\|$/g;

const INLINE_LINK =
  /(?<![!\\])\[(?:[^[\]\\]|\\.|\[[^\]]*\])*\]\(\s*(?:<[^<>\n]+>|[^\s()<>]+(?:\([^\s()]*\)[^\s()<>]*)*)(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)/g;
const MAINTAINING = /^\s{0,3}#{1,6}\s+Maintaining this file(?:\s+#+)?\s*$/;

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

export function isCeiledReadme(repositoryPath: string, files: ReadonlySet<string>): boolean {
  if (repositoryPath === README) return true;
  return repositoryPath.endsWith(`/${README}`) && files.has(`${repositoryPath.slice(0, -README.length)}${MANIFEST}`);
}

type Part = { readonly title: string; readonly lines: readonly MarkdownLine[] };

function charactersIn(lines: readonly MarkdownLine[]): number {
  return lines.reduce((sum, { raw }) => sum + raw.length + 1, 0);
}

function sectionTitle(line: MarkdownLine, next: MarkdownLine | undefined): string | undefined {
  if (line.kind !== "heading") return undefined;
  const atx = SECOND_LEVEL.exec(line.raw);
  if (atx !== null) return atx[1] ?? "";
  return next !== undefined && SETEXT_SECOND.test(next.raw) ? line.raw.trim() : undefined;
}

function partsOf(lines: readonly MarkdownLine[]): readonly Part[] {
  const starts = lines.flatMap((line, index) => {
    const title = sectionTitle(line, lines[index + 1]);
    return title === undefined ? [] : [{ index, title: `\`## ${title}\`` }];
  });
  const bounds = [{ index: 0, title: "the text before the first section" }, ...starts];
  return bounds.map(({ index, title }, at) => ({ title, lines: lines.slice(index, bounds[at + 1]?.index ?? lines.length) }));
}

function largestPart(lines: readonly MarkdownLine[]): { readonly title: string; readonly size: number } {
  return partsOf(lines)
    .map(({ title, lines: held }) => ({ title, size: charactersIn(held) }))
    .reduce((largest, part) => (part.size > largest.size ? part : largest));
}

function cellsOf(raw: string): readonly string[] {
  return raw.trim().replaceAll(ROW_EDGES, "").split(CELL_SEPARATOR).map((cell) => cell.trim());
}

export function readmeFindings(text: string): readonly AgentFinding[] {
  const lines = handWritten(scanMarkdown(text));
  const size = Math.max(charactersIn(lines) - 1, 0);
  const largest = largestPart(lines);
  const ceiling: readonly AgentFinding[] =
    size <= README_CEILING
      ? []
      : [
          {
            line: undefined,
            message: `is ${size} characters, over the 6,000-character ceiling for a README. Its largest section is ${largest.title} at ${largest.size} characters. Move that section to a page under docs/ and link it from the README in one line`,
          },
        ];
  const cells = lines
    .filter(({ kind }) => kind === "table")
    .flatMap(({ line, raw }) =>
      cellsOf(raw)
        .filter((cell) => cell.length > CELL_CEILING)
        .map((cell) => ({
          line,
          message: `holds a ${cell.length}-character table cell, over the 300-character ceiling for a README table cell. Move the detail to a page under docs/ and keep the cell to what a reader scans`,
        })),
    );
  return [...ceiling, ...cells];
}

function blockStarts(lines: readonly MarkdownLine[], type: NodeType): ReadonlySet<number> {
  const read = lines.map(({ kind, raw }) => (kind === "front-matter" ? "" : raw)).join("\n");
  const walker = new Parser().parse(read).walker();
  const starts = new Set<number>();
  for (let step = walker.next(); step !== null; step = walker.next()) {
    if (step.entering && step.node.type === type) starts.add(step.node.sourcepos[0][0]);
  }
  return starts;
}

function linesOpening(text: string, type: NodeType): readonly MarkdownLine[] {
  const lines = scanMarkdown(text);
  const starts = blockStarts(lines, type);
  return lines.filter(({ line }) => starts.has(line)).flatMap(({ line, raw }) => scanMarkdown(raw).map((alone) => ({ ...alone, line })));
}

export function maintainingFinding(text: string): AgentFinding | undefined {
  const heading = linesOpening(text, "heading").find(({ raw }) => MAINTAINING.test(raw));
  if (heading === undefined) return undefined;
  return {
    line: heading.line,
    message: "holds `## Maintaining this file`, which a router leaves out. Delete the section, since checks-docs holds the file's shape",
  };
}

export function entries(text: string): readonly MarkdownLine[] {
  return linesOpening(text, "item");
}

type Tracked = Pick<Snapshot, "files" | "directories">;

const STAYS = new Set(["", "."]);
const NAMES_A_SEGMENT = /[^/]/;

function joined(directory: string, segment: string): string {
  return directory === "" ? segment : `${directory}/${segment}`;
}

function enter(directory: string, segment: string, tracked: Tracked): string | undefined {
  if (STAYS.has(segment)) return directory;
  if (segment === "..") return directory === "" ? undefined : directory.slice(0, Math.max(directory.lastIndexOf("/"), 0));
  const next = joined(directory, segment);
  return tracked.directories.has(next) ? next : undefined;
}

function resolvesFrom(directory: string, span: string, tracked: Tracked): boolean {
  const segments = span.split("/");
  const last = segments.pop() ?? "";
  const walked = segments.reduce<string | undefined>((at, segment) => (at === undefined ? undefined : enter(at, segment, tracked)), directory);
  if (walked === undefined) return false;
  if (!STAYS.has(last) && last !== ".." && tracked.files.has(joined(walked, last))) return true;
  const end = enter(walked, last, tracked);
  return end !== undefined && end !== "";
}

function namesTrackedPath(agentFile: string, span: string, tracked: Tracked): boolean {
  if (!NAMES_A_SEGMENT.test(span)) return false;
  const directory = agentFile.includes("/") ? agentFile.slice(0, agentFile.lastIndexOf("/")) : "";
  const fromFile = resolvesFrom(directory, span, tracked);
  return fromFile || (!span.startsWith("./") && !span.startsWith("../") && resolvesFrom("", span, tracked));
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
