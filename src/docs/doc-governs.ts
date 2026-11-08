import { Option, Schema } from "effect";
import type { Outline, Violation } from "./doc-outline.ts";
import type { Snapshot } from "./doc-references.ts";
import { ADR_STATUSES } from "./doc-templates.ts";

type Status = (typeof ADR_STATUSES)[number];

const RETIRED_STATUSES = ["Superseded", "Retired"] as const satisfies readonly Status[];

const DECIDED_STATUSES = ["Rejected", "Deprecated"] as const satisfies readonly Status[];

const RETIRE = `retire it with ${RETIRED_STATUSES.join(" or ")} in \`## Status\``;
const SAMPLE = "`governs: [src/parts.ts]`";

export type Governs =
  | { readonly type: "absent" }
  | { readonly type: "malformed"; readonly line: number }
  | { readonly type: "listed"; readonly line: number; readonly paths: readonly string[] };

export type GovernedRecord = {
  readonly path: string;
  readonly number: number | undefined;
  readonly governs: Governs;
  readonly title: string | undefined;
  readonly status: string | undefined;
  readonly frontMatter: string;
};

export type Tree = Pick<Snapshot, "files" | "directories">;

export type GovernedFinding = {
  readonly path: string;
  readonly line: number | undefined;
  readonly governed: string;
  readonly message: string;
};

const RECORD_REFERENCE = /\b(\d{4})\b/g;

export function numbersIn(text: string): ReadonlySet<number> {
  return new Set(Array.from(text.matchAll(RECORD_REFERENCE), (match) => Number(match[1])));
}

function isRetired(word: string | undefined): boolean {
  return RETIRED_STATUSES.some((retired) => retired === word);
}

const KEY = /^["']?([^"':]+?)["']?[ \t]*:/;

function keyLine(frontMatter: string, key: string): number | undefined {
  const index = frontMatter.split("\n").findIndex((line) => KEY.exec(line)?.[1] === key);
  return index === -1 ? undefined : index + 1;
}

const decodeFields = Schema.decodeUnknownOption(Schema.Record(Schema.String, Schema.Unknown));
const decodePaths = Schema.decodeUnknownOption(Schema.Array(Schema.NonEmptyString));

function fieldsOf(parsed: unknown): Readonly<Record<string, unknown>> {
  return Option.getOrElse(decodeFields(parsed), () => ({}));
}

export function governsOf(frontMatter: string, parsed: unknown): Governs {
  const fields = fieldsOf(parsed);
  if (!Object.hasOwn(fields, "governs")) return { type: "absent" };
  const line = keyLine(frontMatter, "governs") ?? 1;
  return Option.match(decodePaths(fields["governs"]), {
    onNone: () => ({ type: "malformed", line }),
    onSome: (paths) => ({ type: "listed", line, paths }),
  });
}

export function governsProblems(governs: Governs, status: string | undefined): readonly Violation[] {
  if (governs.type === "absent") {
    return [{ line: 1, message: `has no \`governs\` in its front matter. List the paths the record governs, as in ${SAMPLE}` }];
  }
  if (governs.type === "malformed") {
    return [{ line: governs.line, message: `holds a \`governs\` that is not a list of paths, as in ${SAMPLE}` }];
  }
  if (governs.paths.length > 0 || isRetired(status) || DECIDED_STATUSES.some((decided) => decided === status)) return [];
  return [{ line: governs.line, message: `lists no path in \`governs\`, which a Proposed or Accepted record keeps. List the paths it governs, or ${RETIRE}` }];
}

const SUPERSESSION_KEY = /supersed/i;

export function supersessionKeyProblems(frontMatter: string, parsed: unknown): readonly Violation[] {
  return Object.keys(fieldsOf(parsed))
    .filter((key) => SUPERSESSION_KEY.test(key))
    .map((key) => ({
      line: keyLine(frontMatter, key) ?? 1,
      message: `holds \`${key}\` in its front matter, and a supersession lives in \`## Status\` alone. Move it there`,
    }));
}

const SUPERSESSION = /\bsupersed(?:e|es|ed|ing)\b/i;
const QUOTED = /^ {0,3}>/;
const CODE_SPAN = /(`+)[^`]*?\1/g;
const SENTENCE_END = /(?<=[.!?])\s+/;

function padded(number: number): string {
  return String(number).padStart(4, "0");
}

function supersededIn(text: string, known: ReadonlySet<number>, own: number | undefined): readonly number[] {
  const sentences = text.replace(CODE_SPAN, "").split(SENTENCE_END).filter((sentence) => SUPERSESSION.test(sentence));
  return [...new Set(sentences.flatMap((sentence) => [...numbersIn(sentence)]))].filter((number) => number !== own && known.has(number));
}

export function supersessionProblems(outline: Outline, known: ReadonlySet<number>, own: number | undefined): readonly Violation[] {
  const status = outline.sections.find(({ heading }) => heading.title === "Status");
  const inStatus = new Set([...(status?.body ?? []).map(({ line }) => line), status?.heading.line]);
  return outline.prose.flatMap(({ line, text }) => {
    if (inStatus.has(line) || QUOTED.test(text)) return [];
    const numbers = supersededIn(text, known, own);
    if (numbers.length === 0) return [];
    const named = numbers.map(padded).join(", ");
    return [{ line, message: `states a supersession of ${named} outside \`## Status\`, which is its one home. Move it into \`## Status\`` }];
  });
}

export function existsIn(tree: Tree, path: string): boolean {
  return tree.files.has(path) || tree.directories.has(path);
}

function entryOf(line: string): string {
  const item = line.trim().slice(1).trim().replace(/,$/, "").trim();
  return /^["'](.*)["']$/.exec(item)?.[1] ?? item;
}

function tokensOf(value: string): readonly string[] {
  return value
    .split(/[\s,[\]]+/)
    .map((token) => token.trim())
    .filter((token) => token !== "")
    .map((token) => /^["'](.*)["']$/.exec(token)?.[1] ?? token);
}

function endsFrontMatter(text: string): boolean {
  const trimmed = text.trim();
  return trimmed === "---" || trimmed === "...";
}

function flowLineOf(lines: readonly string[], start: number, governed: string): number | undefined {
  for (let index = start; index < lines.length; index++) {
    const text = lines[index] ?? "";
    if (endsFrontMatter(text)) return undefined;
    if (tokensOf(text).includes(governed)) return index + 1;
    if (text.includes("]")) return undefined;
  }
  return undefined;
}

// A line of "---" also starts with "-", so the end of the front matter is checked before list items.
function blockLineOf(lines: readonly string[], start: number, governed: string): number | undefined {
  for (let index = start; index < lines.length; index++) {
    const text = lines[index] ?? "";
    const trimmed = text.trim();
    if (endsFrontMatter(text)) return undefined;
    if (trimmed.startsWith("-")) {
      if (entryOf(text) === governed) return index + 1;
    } else if (trimmed !== "" && !trimmed.startsWith("#")) {
      return undefined;
    }
  }
  return undefined;
}

function lineOf({ governs, frontMatter }: GovernedRecord, governed: string): number | undefined {
  if (governs.type === "absent") return undefined;
  const lines = frontMatter.split("\n");
  const keyed = lines[governs.line - 1] ?? "";
  if (tokensOf(keyed.slice(keyed.indexOf(":") + 1)).includes(governed)) return governs.line;
  const scan = keyed.includes("[") && !keyed.includes("]") ? flowLineOf : blockLineOf;
  return scan(lines, governs.line, governed) ?? governs.line;
}

export function listedPaths(record: GovernedRecord): readonly string[] {
  return record.governs.type === "listed" ? record.governs.paths : [];
}

export type Governing = {
  readonly path: string;
  readonly status: string | undefined;
  readonly governed: readonly string[];
};

function reaches(governed: string, changed: string): boolean {
  return changed === governed || changed.startsWith(`${governed}/`);
}

export function governingRecords(records: readonly GovernedRecord[], changed: readonly string[]): readonly Governing[] {
  return records
    .filter((record) => !isRetired(record.status))
    .flatMap((record) => {
      const governed = listedPaths(record).filter((path) => changed.some((one) => reaches(path, one)));
      return governed.length === 0 ? [] : [{ path: record.path, status: record.status, governed }];
    });
}

export function missingGoverned(record: GovernedRecord, head: Tree): readonly GovernedFinding[] {
  if (isRetired(record.status)) return [];
  const remedy = DECIDED_STATUSES.some((decided) => decided === record.status) ? "empty the list to `governs: []`" : RETIRE;
  return listedPaths(record)
    .filter((governed) => !existsIn(head, governed))
    .map((governed) => ({
      path: record.path,
      line: lineOf(record, governed),
      governed,
      message: `governs \`${governed}\`, which is not in the repository. Name a tracked file or directory, or ${remedy}`,
    }));
}

function successorOf(record: GovernedRecord, after: readonly GovernedRecord[]): GovernedRecord | undefined {
  return after.find((other) => (record.number === undefined ? other.path === record.path : other.number === record.number));
}

function deletionFinding(record: GovernedRecord, governed: string, after: readonly GovernedRecord[]): GovernedFinding | undefined {
  const successor = successorOf(record, after);
  if (successor === undefined) {
    return { path: record.path, line: undefined, governed, message: `is deleted with \`${governed}\`, which it governs. Keep the record and ${RETIRE}` };
  }
  if (isRetired(successor.status)) return undefined;
  return {
    path: successor.path,
    line: lineOf(successor, governed),
    governed,
    message: `governs \`${governed}\`, which the range deletes. In the same change, ${RETIRE}`,
  };
}

export function deletedGoverned(before: readonly GovernedRecord[], after: readonly GovernedRecord[], base: Tree, head: Tree): readonly GovernedFinding[] {
  return before
    .filter((record) => !isRetired(record.status))
    .flatMap((record) =>
      listedPaths(record)
        .filter((governed) => existsIn(base, governed) && !existsIn(head, governed))
        .flatMap((governed) => deletionFinding(record, governed, after) ?? []),
    );
}
