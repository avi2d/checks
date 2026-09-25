import {
  firstText,
  marked,
  matchSections,
  outlineProblems,
  parseOutline,
  ruleProblem,
  type Heading,
  type Outline,
  type Violation,
  VERSION,
} from "./doc-outline.ts";
import { ADR_STATUSES, TEMPLATES, templateFile, type Kind, type Title } from "./doc-templates.ts";
import { ADR_DIRECTORY, DOCS_DIRECTORY } from "./prose-matchers.ts";
import { MODES, type Docs, type Mode } from "./quality-file.ts";

export type Placement =
  | { readonly type: "judged"; readonly kind: Kind }
  | { readonly type: "undeclared" }
  | { readonly type: "ambiguous"; readonly modes: readonly Mode[] }
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

export function placementOf(path: string, docs: Docs | undefined): Placement {
  const root = ROOT_FILES.get(path);
  if (root !== undefined) return { type: "judged", kind: root };
  if (!path.endsWith(".md") || path === ADR_INDEX) return { type: "unjudged" };
  if (path.startsWith(ADR_DIRECTORY)) return { type: "judged", kind: "adr" };
  const modes = MODES.filter((mode) => (docs?.pages?.[mode] ?? []).some((glob) => new Bun.Glob(glob).match(path)));
  const [mode, ...others] = modes;
  if (mode !== undefined) return others.length === 0 ? { type: "judged", kind: mode } : { type: "ambiguous", modes };
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

function statusProblem(outline: Outline): Violation | undefined {
  const status = outline.sections.find(({ heading }) => heading.title === "Status");
  if (status === undefined) return undefined;
  const opening = firstText(status.body);
  const word = opening?.text.trim().split(/\s+/, 1)[0]?.replace(/[.,;:]+$/, "");
  if (ADR_STATUSES.some((known) => known === word)) return undefined;
  const found = word === undefined ? "nothing" : `\`${word}\``;
  return { line: opening?.line ?? status.heading.line, message: `\`## Status\` opens with ${found} where one of ${ADR_STATUSES.join(", ")} goes` };
}

function adrProblems(path: string, outline: Outline, records: readonly string[]): readonly Violation[] {
  const violations: Violation[] = [];
  const filed = recordNumber(path);
  if (filed === undefined) {
    violations.push({ line: 1, message: `is not named as a record, a four-digit number and a kebab-case name directly in ${ADR_DIRECTORY}` });
  }
  const title = titleOf(outline);
  const titled = title === undefined ? undefined : RECORD_TITLE.exec(title.title)?.[1];
  if (title !== undefined && titled === undefined) {
    violations.push({ line: title.line, message: `${marked(1, title.title)} does not open with the record's number, as in \`# 7. The decision\`` });
  }
  if (title !== undefined && titled !== undefined && filed !== undefined && Number(titled) !== filed) {
    violations.push({ line: title.line, message: `${marked(1, title.title)} carries number ${titled}, and the file name ${filed}` });
  }
  const dated = firstText(outline.lead);
  if (!isDate(DATE_LINE.exec(dated?.text.trim() ?? "")?.[1])) {
    violations.push({ line: dated?.line ?? 1, message: "does not follow its title with a `Date: YYYY-MM-DD` line" });
  }
  const status = statusProblem(outline);
  if (status !== undefined) violations.push(status);
  const sharing = records.filter((other) => other !== path && filed !== undefined && recordNumber(other) === filed);
  if (sharing.length > 0) violations.push({ line: 1, message: `shares number ${filed} with ${sharing.join(", ")}` });
  return violations;
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

function kindProblems(kind: Kind, doc: Doc, outline: Outline, records: readonly string[]): readonly Violation[] {
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

export function judge(kind: Kind, doc: Doc, records: readonly string[]): readonly Violation[] {
  const template = TEMPLATES[kind];
  if (template.shape === "exact") return exactProblems(kind, template.text, doc.text);
  const outline = parseOutline(doc.text);
  const title = titleOf(outline);
  return [
    ...outlineProblems(outline),
    ...(title === undefined ? [] : titleProblems(template.title, title)),
    ...matchSections(outline.sections, template.sections, 2, title?.line ?? 1),
    ...kindProblems(kind, doc, outline, records),
  ].toSorted((a, b) => a.line - b.line);
}

export function placementProblem(placement: Placement): string | undefined {
  if (placement.type === "undeclared") {
    return `is a page under ${DOCS_DIRECTORY} with no mode; declare it under docs.pages in quality.json as ${MODES.join(", ")}`;
  }
  if (placement.type === "ambiguous") return `is declared under docs.pages as ${placement.modes.join(" and ")}, and a page has one mode`;
  return undefined;
}
