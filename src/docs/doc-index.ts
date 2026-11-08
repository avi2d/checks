import { listedPaths, type GovernedRecord } from "./doc-governs.ts";
import { ADR_DIRECTORY } from "./prose-matchers.ts";

export const INDEX_WRITER = "checks-adr-index";

const BLOCK = "adr-index";
const OPENING = `<!-- generated ${BLOCK}: ${INDEX_WRITER} writes it from the records in ${ADR_DIRECTORY} -->`;
const OPENS = `<!-- generated ${BLOCK}:`;
const CLOSING = `<!-- end generated ${BLOCK} -->`;
const TITLE = "# Decision records";
const NUMBERED = /^\d+\.\s+/;
const FILED = /^(\d{4})-/;

export type IndexState =
  | { readonly type: "fresh" }
  | { readonly type: "missing" }
  | { readonly type: "unmarked" }
  | { readonly type: "stale"; readonly line: number };

function cell(text: string): string {
  return text.replaceAll("|", "\\|");
}

function rowOf(record: GovernedRecord): string {
  const file = record.path.slice(ADR_DIRECTORY.length);
  const number = FILED.exec(file)?.[1] ?? file;
  const title = (record.title ?? "").replace(NUMBERED, "");
  const governs = listedPaths(record).map((path) => `\`${path}\``).join(", ");
  return `| [${number}](${file}) | ${cell(title)} | ${cell(record.status ?? "")} | ${cell(governs)} |`;
}

function indexBlock(records: readonly GovernedRecord[]): readonly string[] {
  const rows = records.toSorted((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)).map(rowOf);
  return [OPENING, "", "| Number | Title | Status | Governs |", "| --- | --- | --- | --- |", ...rows, "", CLOSING];
}

function blockSpan(lines: readonly string[]): { readonly start: number; readonly end: number } | undefined {
  const start = lines.findIndex((line) => line.startsWith(OPENS));
  const end = start === -1 ? -1 : lines.indexOf(CLOSING, start);
  return end === -1 ? undefined : { start, end };
}

export function indexState(readme: string | undefined, records: readonly GovernedRecord[]): IndexState {
  if (readme === undefined) return { type: "missing" };
  const lines = readme.split("\n");
  const span = blockSpan(lines);
  if (span === undefined) return { type: "unmarked" };
  const held = lines.slice(span.start, span.end + 1);
  const expected = indexBlock(records);
  const differs = expected.findIndex((line, index) => held[index] !== line);
  if (differs === -1 && held.length === expected.length) return { type: "fresh" };
  return { type: "stale", line: span.start + (differs === -1 ? expected.length : differs) + 1 };
}

export function writtenIndex(readme: string | undefined, records: readonly GovernedRecord[]): string {
  const block = indexBlock(records);
  if (readme === undefined) return [TITLE, "", ...block, ""].join("\n");
  const lines = readme.split("\n");
  const span = blockSpan(lines);
  if (span === undefined) return [readme.trimEnd(), "", ...block, ""].join("\n");
  return [...lines.slice(0, span.start), ...block, ...lines.slice(span.end + 1)].join("\n");
}
