import { Option, Result, Schema } from "effect";
import {
  firstText,
  marked,
  matchSections,
  outlineProblems,
  parseOutline,
  ruleProblem,
  type Heading,
  type Outline,
  type Section,
  type Violation,
  VERSION,
} from "./doc-outline.ts";
import { ADR_STATUSES, MODES, TEMPLATES, templateFile, type Kind, type Title } from "./doc-templates.ts";
import { ADR_DIRECTORY, DOCS_DIRECTORY } from "./prose-matchers.ts";

export type Placement =
  | { readonly type: "judged"; readonly kind: Kind }
  | { readonly type: "undeclared" }
  | { readonly type: "unjudged" };

export type Doc = {
  readonly path: string;
  readonly text: string;
};

export { ADR_DIRECTORY };
// A generated index takes its shape from its generator.
export const ADR_INDEX = `${ADR_DIRECTORY}README.md`;

export const ROOT_FILES: ReadonlyMap<string, Kind> = new Map<string, Kind>([
  ["README.md", "readme"],
  ["CHANGELOG.md", "changelog"],
  ["AGENTS.md", "agents"],
  ["CLAUDE.md", "claude"],
  ["CONTRIBUTING.md", "how-to"],
]);

const FRONT_MATTER = /^---\r?\n(?:([\s\S]*?)\r?\n)?(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/;
const Fields = Schema.Struct({ kind: Schema.optionalKey(Schema.String), audience: Schema.optionalKey(Schema.String) });
const decodeFields = Schema.decodeUnknownOption(Fields);

function frontMatterOf(text: string): { readonly text: string; readonly fields: typeof Fields.Type } {
  const match = FRONT_MATTER.exec(text);
  if (match === null) return { text: "", fields: {} };
  const parsed = Result.getOrUndefined(Result.try(() => Bun.YAML.parse(match[1] ?? "")));
  return { text: match[0], fields: Option.getOrElse(decodeFields(parsed), () => ({})) };
}

export function speaksToConsumers(text: string): boolean {
  return frontMatterOf(text).fields.audience === "consumers";
}

export function placementOf(path: string, text = ""): Placement {
  const root = ROOT_FILES.get(path);
  if (root !== undefined) return { type: "judged", kind: root };
  if (!path.endsWith(".md") || path === ADR_INDEX) return { type: "unjudged" };
  if (path.startsWith(ADR_DIRECTORY)) return { type: "judged", kind: "adr" };
  const named = frontMatterOf(text).fields.kind;
  const mode = MODES.find((known) => known === named);
  if (mode !== undefined) return { type: "judged", kind: mode };
  return path.startsWith(DOCS_DIRECTORY) ? { type: "undeclared" } : { type: "unjudged" };
}

function titleOf({ headings: [first] }: Outline): Heading | undefined {
  return first?.level === 1 && first.line === 1 ? first : undefined;
}

function titleProblems(title: Title, heading: Heading): readonly Violation[] {
  const named = marked(1, heading.title);
  const at = (message: string) => [{ line: heading.line, message: `${named} ${message}` }];
  if (title.type === "fixed") return heading.title === title.text ? [] : at(`is not the template's title, ${marked(1, title.text)}`);
  const prefix = title.prefix ?? "";
  if (!heading.title.startsWith(prefix)) return at(`does not open with \`${prefix}\``);
  const problem = ruleProblem(title.rule, heading.title.slice(prefix.length));
  return problem === undefined ? [] : at(problem);
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isDate(text: string | undefined): boolean {
  if (text === undefined || !ISO_DATE.test(text)) return false;
  const parsed = new Date(`${text}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(text);
}

const RECORD_NAME = /^(\d{4})-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/;
const RECORD_TITLE = /^(\d+)\. \S/;
const DATE_LINE = /^Date: (\S+)$/;

function recordNumber(path: string): number | undefined {
  const name = RECORD_NAME.exec(path.slice(ADR_DIRECTORY.length))?.[1];
  return name === undefined ? undefined : Number(name);
}

const REVISION_CLAUSE = /\b(?:amend(?:s|ed)|narrow(?:s|ed)|supersede[sd])\b(?:[^.]|\.(?=\S))*/gi;
const RECORD_REFERENCE = /\b(\d{4})\b/g;

function numbersIn(text: string): ReadonlySet<number> {
  return new Set(Array.from(text.matchAll(RECORD_REFERENCE), (match) => Number(match[1])));
}

function revisedIn(status: string): ReadonlySet<number> {
  return new Set((status.match(REVISION_CLAUSE) ?? []).flatMap((clause) => [...numbersIn(clause)]));
}

function padded(number: number): string {
  return String(number).padStart(4, "0");
}

function outlineOf(text: string): Outline {
  return parseOutline(text.slice(frontMatterOf(text).text.length));
}

function statusSection(outline: Outline): Section | undefined {
  return outline.sections.find(({ heading }) => heading.title === "Status");
}

type StatusLinks = {
  readonly cited: ReadonlySet<number>;
  readonly revised: ReadonlySet<number>;
};

function statusLinks(section: Section): StatusLinks {
  const text = section.body.map(({ text: body }) => body).join("\n");
  return { cited: numbersIn(text), revised: revisedIn(text) };
}

export type Records = {
  readonly paths: readonly string[];
  readonly links: ReadonlyMap<number, StatusLinks>;
};

export function recordsOf(records: readonly Doc[]): Records {
  const links = new Map<number, StatusLinks>();
  for (const { path, text } of records) {
    const number = recordNumber(path);
    const section = number === undefined || links.has(number) ? undefined : statusSection(outlineOf(text));
    if (number !== undefined && section !== undefined) links.set(number, statusLinks(section));
  }
  return { paths: records.map(({ path }) => path), links };
}

function pairProblems(filed: number, own: Section, mine: StatusLinks, number: number, other: StatusLinks): readonly Violation[] {
  if (number === filed) return [];
  if (mine.revised.has(number) && !other.cited.has(filed)) {
    const line = own.body.find(({ text: body }) => body.includes(padded(number)))?.line ?? own.heading.line;
    return [{ line, message: `\`## Status\` names ${padded(number)} without ${padded(number)} naming ${padded(filed)} back` }];
  }
  if (other.revised.has(filed) && !mine.cited.has(number)) {
    return [{ line: own.heading.line, message: `\`## Status\` is named by ${padded(number)} without naming ${padded(number)} back` }];
  }
  return [];
}

function revisionLinkProblems(path: string, outline: Outline, links: ReadonlyMap<number, StatusLinks>): readonly Violation[] {
  const filed = recordNumber(path);
  const own = filed === undefined ? undefined : statusSection(outline);
  if (filed === undefined || own === undefined) return [];
  const mine = statusLinks(own);
  return [...links].flatMap(([number, other]) => pairProblems(filed, own, mine, number, other));
}

function statusProblem(outline: Outline): Violation | undefined {
  const status = statusSection(outline);
  if (status === undefined) return undefined;
  const opening = firstText(status.body);
  const word = opening?.text.trim().split(/\s+/, 1)[0]?.replace(/[.,;:]+$/, "");
  if (ADR_STATUSES.some((known) => known === word)) return undefined;
  const found = word === undefined ? "nothing" : `\`${word}\``;
  return { line: opening?.line ?? status.heading.line, message: `\`## Status\` opens with ${found} where one of ${ADR_STATUSES.join(", ")} goes` };
}

function recordTitleProblem(outline: Outline, filed: number | undefined): Violation | undefined {
  const title = titleOf(outline);
  if (title === undefined) return undefined;
  const titled = RECORD_TITLE.exec(title.title)?.[1];
  if (titled === undefined) {
    return { line: title.line, message: `${marked(1, title.title)} does not open with the record's number, as in \`# 7. The decision\`` };
  }
  if (filed === undefined || Number(titled) === filed) return undefined;
  return { line: title.line, message: `${marked(1, title.title)} carries number ${titled}, and the file name ${filed}` };
}

function recordDateProblem({ lead }: Outline): Violation | undefined {
  const dated = firstText(lead);
  if (isDate(DATE_LINE.exec(dated?.text.trim() ?? "")?.[1])) return undefined;
  return { line: dated?.line ?? 1, message: "does not follow its title with a `Date: YYYY-MM-DD` line" };
}

function sharedNumberProblem(path: string, filed: number | undefined, records: readonly string[]): Violation | undefined {
  if (filed === undefined) return undefined;
  const sharing = records.filter((other) => other !== path && recordNumber(other) === filed);
  return sharing.length === 0 ? undefined : { line: 1, message: `shares number ${filed} with ${sharing.join(", ")}` };
}

function adrProblems(path: string, outline: Outline, records: Records): readonly Violation[] {
  const filed = recordNumber(path);
  const misnamed: Violation | undefined =
    filed === undefined
      ? { line: 1, message: `is not named as a record, a four-digit number and a kebab-case name directly in ${ADR_DIRECTORY}` }
      : undefined;
  return [
    misnamed,
    recordTitleProblem(outline, filed),
    recordDateProblem(outline),
    statusProblem(outline),
    sharedNumberProblem(path, filed, records.paths),
    ...revisionLinkProblems(path, outline, records.links),
  ].filter((violation) => violation !== undefined);
}

export const RELEASED = /^Released (\S+)\.$/;

function changelogProblems({ sections }: Outline): readonly Violation[] {
  const releases = sections.filter(({ heading }) => VERSION.test(heading.title));
  return releases.flatMap(({ heading, body }, index) => {
    const named = marked(2, heading.title);
    const dated = firstText(body);
    const violations: Violation[] = [];
    if (!isDate(RELEASED.exec(dated?.text.trim() ?? "")?.[1])) {
      violations.push({ line: dated?.line ?? heading.line, message: `${named} does not open with a \`Released YYYY-MM-DD.\` line` });
    }
    const newer = releases[index - 1]?.heading.title;
    if (newer !== undefined && Bun.semver.order(newer, heading.title) !== 1) {
      violations.push({ line: heading.line, message: `${named} follows ${marked(2, newer)}, and releases run newest first` });
    }
    return violations;
  });
}

const STEP = /^ {0,3}\d+[.)][ \t]+\S/;

function stepsProblems(kind: Kind, { prose }: Outline): readonly Violation[] {
  if (prose.some(({ text }) => STEP.test(text))) return [];
  return [{ line: 1, message: `numbers no steps, which a ${kind} page lists as \`1.\` items` }];
}

function kindProblems(kind: Kind, doc: Doc, outline: Outline, records: Records): readonly Violation[] {
  if (kind === "adr") return adrProblems(doc.path, outline, records);
  if (kind === "changelog") return changelogProblems(outline);
  if (kind === "how-to" || kind === "tutorial") return stepsProblems(kind, outline);
  return [];
}

function exactProblems(kind: Kind, expected: string, actual: string): readonly Violation[] {
  if (actual === expected) return [];
  const want = expected.split("\n");
  const have = actual.split("\n");
  const line = want.findIndex((text, index) => have[index] !== text) + 1 || want.length + 1;
  return [{ line, message: `differs from ${templateFile(kind)}, which it holds word for word` }];
}

export function judge(kind: Kind, doc: Doc, records: Records): readonly Violation[] {
  const template = TEMPLATES[kind];
  if (template.shape === "exact") return exactProblems(kind, template.text, doc.text);
  const frontMatter = frontMatterOf(doc.text).text;
  const outline = parseOutline(doc.text.slice(frontMatter.length));
  const lineOffset = frontMatter === "" ? 0 : frontMatter.split("\n").length - 1;
  const title = titleOf(outline);
  return [
    ...outlineProblems(outline),
    ...(title === undefined ? [] : titleProblems(template.title, title)),
    ...matchSections(outline.sections, template.sections, 2, title?.line ?? 1),
    ...kindProblems(kind, doc, outline, records),
  ].map(({ line, message }) => ({ line: line + lineOffset, message })).toSorted((a, b) => a.line - b.line);
}

export function placementProblem(placement: Placement): string | undefined {
  if (placement.type === "undeclared") {
    return `is a page under ${DOCS_DIRECTORY} with no mode; add kind: ${MODES.join(", ")} in YAML front matter`;
  }
  return undefined;
}
