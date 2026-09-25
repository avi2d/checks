export type ProseFinding = { readonly line: number; readonly message: string };

export type LineKind = "prose" | "heading" | "table" | "html" | "definition" | "break" | "blank" | "code" | "front-matter";

export type MarkdownLine = {
  readonly line: number;
  readonly kind: LineKind;
  readonly raw: string;
  readonly prose: string;
  readonly code: readonly string[];
  readonly links: readonly string[];
};

export type Reader = "people" | "agents";

export type ProseRule = {
  readonly readers: readonly Reader[];
  readonly refuses: string;
  readonly example: string;
  readonly instead: string;
};

type MatchedRule = ProseRule & { readonly find: RegExp };

export const ADR_DIRECTORY = "docs/adr/";
export const DOCS_DIRECTORY = "docs/";
export const LIVING_NAMES: readonly string[] = ["README.md", "CONTRIBUTING.md"];
export const AGENT_NAMES: readonly string[] = ["AGENTS.md", "CLAUDE.md"];
export const HISTORY_NAMES: readonly string[] = ["CHANGELOG.md"];
export const DATED_RECORD_EXAMPLES: readonly string[] = ["0001-", "2026-05-08-"];
const DATED_RECORD = /^\d{4}-/;

export function isLivingDoc(repositoryPath: string): boolean {
  const name = repositoryPath.slice(repositoryPath.lastIndexOf("/") + 1);
  if (HISTORY_NAMES.includes(name) || AGENT_NAMES.includes(name) || DATED_RECORD.test(name) || repositoryPath.startsWith(ADR_DIRECTORY)) return false;
  return LIVING_NAMES.includes(name) || (repositoryPath.startsWith(DOCS_DIRECTORY) && name.endsWith(".md"));
}

export function readerOf(repositoryPath: string): Reader | undefined {
  if (isLivingDoc(repositoryPath)) return "people";
  return AGENT_NAMES.includes(repositoryPath.slice(repositoryPath.lastIndexOf("/") + 1)) ? "agents" : undefined;
}

// Masking keeps each line's length, so a column in the masked prose is the same column in the raw line.
const HIDDEN = "\0";
const BLANK = " ";

type Masked = { readonly prose: string; readonly code: string[]; readonly links: string[]; readonly inComment: boolean };

const AUTOLINK = /^<(?:[A-Za-z][A-Za-z0-9+.-]{1,31}:[^\s<>]*|[^\s@<>]+@[^\s<>]+)>/;
const HTML_TAG = /^<\/?[A-Za-z][A-Za-z0-9-]*(?:\s[^<>]*)?\/?>/;
const BARE_URL = /^https?:\/\/[^\s<>]*[^\s<>.,:;!?'")\]]/;
const ENTITY = /^&(?:#\d+|#x[0-9a-f]+|[a-z][a-z0-9]*);/i;
const WORD = /\w/;

function hiddenAt(raw: string, at: number, rest: string): { readonly length: number; readonly fill: string } | undefined {
  const char = raw.charAt(at);
  const url = char === "h" && !WORD.test(raw.charAt(at - 1)) ? BARE_URL.exec(rest) : null;
  const visible = url ?? (char === "&" ? ENTITY.exec(rest) : null) ?? (char === "<" ? AUTOLINK.exec(rest) : null);
  if (visible !== null) return { length: visible[0].length, fill: HIDDEN };
  const tag = char === "<" ? HTML_TAG.exec(rest) : null;
  return tag === null ? undefined : { length: tag[0].length, fill: BLANK };
}

function runOf(raw: string, at: number, char: string): number {
  let end = at;
  while (raw[end] === char) end += 1;
  return end - at;
}

function closingRun(raw: string, from: number, length: number): number {
  for (let at = raw.indexOf("`", from); at >= 0; at = raw.indexOf("`", at + 1)) {
    const run = runOf(raw, at, "`");
    if (run === length) return at;
    at += run - 1;
  }
  return -1;
}

function destinationEnd(raw: string, open: number): number {
  let depth = 0;
  for (let at = open + 1; at < raw.length; at += 1) {
    const char = raw[at];
    if (char === "\\") at += 1;
    else if (char === "(") depth += 1;
    else if (char === ")") {
      if (depth === 0) return at;
      depth -= 1;
    }
  }
  return -1;
}

function targetOf(destination: string): string {
  const trimmed = destination.trim();
  if (trimmed.startsWith("<")) return trimmed.slice(1, Math.max(trimmed.indexOf(">"), 1));
  return trimmed.split(/\s/, 1)[0] ?? "";
}

type Masking = { readonly raw: string; readonly out: string[]; readonly code: string[]; readonly links: string[]; inComment: boolean };

function hide(masking: Masking, from: number, to: number, fill: string): void {
  for (let at = from; at < to; at += 1) masking.out[at] = fill;
}

// A step returns an index past `at`, or undefined when its token does not start there.
function commentStep(masking: Masking, at: number): number | undefined {
  const { raw } = masking;
  if (!masking.inComment) {
    if (!raw.startsWith("<!--", at)) return undefined;
    hide(masking, at, at + 4, BLANK);
    masking.inComment = true;
    return at + 4;
  }
  const close = raw.indexOf("-->", at);
  const end = close < 0 ? raw.length : close + 3;
  hide(masking, at, end, BLANK);
  masking.inComment = close < 0;
  return end;
}

function codeSpanStep(masking: Masking, at: number): number | undefined {
  const { raw } = masking;
  if (raw.charAt(at) !== "`") return undefined;
  const run = runOf(raw, at, "`");
  const close = closingRun(raw, at + run, run);
  if (close < 0) return at + run;
  masking.code.push(raw.slice(at + run, close).trim());
  hide(masking, at, close + run, HIDDEN);
  return close + run;
}

function linkStep(masking: Masking, at: number): number | undefined {
  const { raw } = masking;
  const end = raw.startsWith("](", at) ? destinationEnd(raw, at + 1) : -1;
  if (end < 0) return undefined;
  masking.links.push(targetOf(raw.slice(at + 2, end)));
  hide(masking, at + 1, end + 1, HIDDEN);
  return end + 1;
}

function hiddenStep(masking: Masking, at: number): number | undefined {
  const hidden = hiddenAt(masking.raw, at, masking.raw.slice(at));
  if (hidden === undefined) return undefined;
  hide(masking, at, at + hidden.length, hidden.fill);
  return at + hidden.length;
}

const MASK_STEPS = [commentStep, codeSpanStep, linkStep, hiddenStep];

function maskStep(masking: Masking, at: number): number {
  for (const step of MASK_STEPS) {
    const next = step(masking, at);
    if (next !== undefined) return next;
  }
  return at + 1;
}

function mask(raw: string, startsInComment: boolean): Masked {
  const masking: Masking = { raw, out: raw.split(""), code: [], links: [], inComment: startsInComment };
  let at = 0;
  while (at < raw.length) at = maskStep(masking, at);
  return { prose: masking.out.join(""), code: masking.code, links: masking.links, inComment: masking.inComment };
}

const FENCE = /^\s*(`{3,}|~{3,})(.*)$/;
const DEFINITION = /^\s{0,3}\[[^\]]+\]:\s*(\S+)/;
const HEADING = /^\s{0,3}#{1,6}(?:\s|$)/;
const BREAK = /^\s{0,3}(?:[-*_](?:\s*[-*_]){2,}|=+|-+)\s*$/;
const UNDERLINE = /^\s{0,3}(?:=+|-+)\s*$/;
const HTML_BLOCK = /^\s{0,3}<[A-Za-z/!?]/;

function fenceOpener(raw: string): string | undefined {
  const match = FENCE.exec(raw);
  if (match === null) return undefined;
  const [, fence = "", info = ""] = match;
  return fence.startsWith("`") && info.includes("`") ? undefined : fence;
}

function fenceCloses(raw: string, opener: string): boolean {
  const closer = FENCE.exec(raw);
  return closer !== null && closer[1]?.[0] === opener[0] && (closer[1]?.length ?? 0) >= opener.length && closer[2]?.trim() === "";
}

function kindOf(raw: string, prose: string): LineKind {
  if (raw.trim() === "") return "blank";
  if (HEADING.test(raw)) return "heading";
  if (BREAK.test(raw)) return "break";
  if (raw.trimStart().startsWith("|")) return "table";
  if (HTML_BLOCK.test(raw) && !AUTOLINK.test(raw.trimStart())) return "html";
  return prose.trim() === "" ? "blank" : "prose";
}

function unread(line: number, raw: string, kind: LineKind): MarkdownLine {
  return { line, kind, raw, prose: BLANK.repeat(raw.length), code: [], links: [] };
}

function settext(lines: MarkdownLine[]): MarkdownLine[] {
  return lines.map((line, index) => {
    const next = lines[index + 1];
    return line.kind === "prose" && next?.kind === "break" && UNDERLINE.test(next.raw) ? { ...line, kind: "heading" } : line;
  });
}

function frontMatterLength(raws: readonly string[]): number {
  if (raws[0] !== "---") return 0;
  const close = raws.findIndex((raw, index) => index > 0 && (raw === "---" || raw === "..."));
  return close < 0 ? raws.length : close + 1;
}

type Scanning = { fence: string | undefined; inComment: boolean; inHtmlBlock: boolean };

function scanLine(line: number, raw: string, scanning: Scanning): MarkdownLine {
  if (scanning.fence !== undefined) {
    if (fenceCloses(raw, scanning.fence)) scanning.fence = undefined;
    return unread(line, raw, "code");
  }
  const opener = scanning.inComment ? undefined : fenceOpener(raw);
  if (opener !== undefined) {
    scanning.fence = opener;
    return unread(line, raw, "code");
  }
  const definition = scanning.inComment ? null : DEFINITION.exec(raw);
  if (definition !== null) return { ...unread(line, raw, "definition"), links: [targetOf(definition[1] ?? "")] };
  const masked = mask(raw, scanning.inComment);
  scanning.inComment = masked.inComment;
  const kind = kindOf(raw, masked.prose);
  // An HTML block runs to the next blank line, whatever its later lines open with.
  scanning.inHtmlBlock = kind === "html" || (scanning.inHtmlBlock && kind !== "blank");
  return { line, kind: scanning.inHtmlBlock ? "html" : kind, raw, prose: masked.prose, code: masked.code, links: masked.links };
}

export function scanMarkdown(text: string): readonly MarkdownLine[] {
  const raws = text.split("\n").map((raw) => raw.replace(/\r$/, ""));
  const frontMatter = frontMatterLength(raws);
  const scanning: Scanning = { fence: undefined, inComment: false, inHtmlBlock: false };
  const lines: MarkdownLine[] = [];
  for (const [index, raw] of raws.entries()) {
    lines.push(index < frontMatter ? unread(index + 1, raw, "front-matter") : scanLine(index + 1, raw, scanning));
  }
  return settext(lines);
}

const LEADING_MARKERS = /^(?:\s*>)*\s*(?:#{1,6}\s+|(?:[-*+]|\d{1,9}[.)])\s+(?:\[[ xX]\]\s+)?)?/;

function bodyOf({ prose }: MarkdownLine): string {
  const markers = LEADING_MARKERS.exec(prose)?.[0] ?? "";
  return BLANK.repeat(markers.length) + prose.slice(markers.length);
}

const SEPARATOR_INSTEAD = "End the sentence, or use a comma";

const PROMISES: readonly (readonly [shows: string, pattern: string])[] = [
  ["until #11", String.raw`until \[?(?:[\w.-]+\/[\w.-]+)?#\d+`],
  ["is planned", "(?:is|are) planned"],
  ["will soon", "will soon"],
  ["coming soon", "coming soon"],
  ["in a future release", "in a future (?:release|version)"],
];

const code = (text: string): string => `\`${text}\``;
const EVERY_READER: readonly Reader[] = ["people", "agents"];
const PEOPLE: readonly Reader[] = ["people"];

const RULES: readonly MatchedRule[] = [
  { readers: EVERY_READER, refuses: "an em dash", example: code("—"), instead: SEPARATOR_INSTEAD, find: /—/g },
  { readers: EVERY_READER, refuses: "an en dash", example: code("–"), instead: SEPARATOR_INSTEAD, find: /–/g },
  {
    readers: EVERY_READER,
    refuses: "a parenthesis other than the plural `(s)`",
    example: code("("),
    instead: "Make the aside its own sentence, or set it off with commas",
    find: /\((?!s\))/g,
  },
  {
    readers: EVERY_READER,
    refuses: "a hyphen used as a dash",
    example: `${code("a - b")} or ${code("a -- b")}`,
    instead: SEPARATOR_INSTEAD,
    find: /(?<=[^\s|]) -{1,3} (?=[^\s|])/g,
  },
  { readers: EVERY_READER, refuses: "a semicolon", example: code(";"), instead: "Use two sentences", find: /;/g },
  {
    readers: PEOPLE,
    refuses: "a promise about the future",
    example: PROMISES.map(([shows]) => code(shows)).join(", "),
    instead: "Say what is true now",
    find: new RegExp(PROMISES.map(([, pattern]) => String.raw`\b${pattern}\b`).join("|"), "gi"),
  },
  {
    readers: PEOPLE,
    refuses: "a sentence that opens by talking about the page",
    example: code("This page explains"),
    instead: "Talk directly about the subject",
    find: /(?<=^\s*|[.!?:]\s+)(?:this|the following|in this) (?:page|topic|section|document|doc|guide|tutorial|article|readme|file|chapter)\b(?: \w+)?/gi,
  },
];

const SECOND_SENTENCE: ProseRule = {
  readers: PEOPLE,
  refuses: "a second sentence on one line",
  example: code("It builds. It ships."),
  instead: "Start it on its own line",
};

const RUN_ON: ProseRule = {
  readers: PEOPLE,
  refuses: "a sentence that runs across lines",
  example: `${code("It builds")} with ${code("and ships.")} on the next line`,
  instead: "Join the sentence onto one line",
};

export const PROSE_RULES: readonly ProseRule[] = [
  ...RULES.map(({ readers, refuses, example, instead }) => ({ readers, refuses, example, instead })),
  SECOND_SENTENCE,
  RUN_ON,
];

const JUDGED_KINDS: ReadonlySet<LineKind> = new Set(["prose", "heading", "table", "html"]);

function ruleFindings(line: MarkdownLine, reader: Reader): ProseFinding[] {
  const body = bodyOf(line);
  return RULES.filter(({ readers }) => readers.includes(reader)).flatMap(({ refuses, instead, find }) =>
    [...body.matchAll(find)].map(([match]) => ({ line: line.line, message: `carries \`${match.trim()}\`, ${refuses}. ${instead}` })),
  );
}

const SENTENCE_BREAK = /(?<=[^\s.!?])[.!?]["'”’)\]*_]*\s+(?=[A-Z"“*_[\0])/g;
const ABBREVIATION = /\b(?:e\.g|i\.e|etc|vs|cf|approx|Mr|Mrs|Ms|Dr|St|No|Fig)$/i;
const SENTENCE_END = /[.!?:]["'”’)\]*_]*\s*$/;
const LIST_ITEM = /^(?:\s*>)*\s*(?:[-*+]|\d{1,9}[.)])(?:\s|$)/;
const QUOTE_DEPTH = /^(?:\s*>)*/;

// A bold label that opens a line, as in **Status.**, heads the sentence after it rather than being one.
const RUN_IN_LABEL = /^\s*(\*\*|__)(?:(?!\1).)+?[.!?:]\1\s/;

function secondSentence(line: MarkdownLine): ProseFinding | undefined {
  const body = bodyOf(line);
  const label = RUN_IN_LABEL.exec(body)?.[0].length ?? 0;
  for (const match of body.matchAll(SENTENCE_BREAK)) {
    if (match.index < label || ABBREVIATION.test(body.slice(0, match.index))) continue;
    const opening = line.raw.slice(match.index + match[0].length).split(/\s+/, 3).join(" ").replace(/[.!?,:]+$/, "");
    return { line: line.line, message: `carries ${SECOND_SENTENCE.refuses}, which opens with \`${opening}\`. ${SECOND_SENTENCE.instead}` };
  }
  return undefined;
}

const OPENS_LOWERCASE = /^\s*[a-z]/;

// A sentence may end inside the code or link that closes its line, so only a lowercase next line proves it runs on.
function endsMidSentence(line: MarkdownLine, next: MarkdownLine): boolean {
  const body = bodyOf(line).trimEnd();
  if (SENTENCE_END.test(body) || line.raw.endsWith("  ") || line.raw.endsWith("\\")) return false;
  return !body.endsWith(HIDDEN) || OPENS_LOWERCASE.test(bodyOf(next));
}

function continues(earlier: MarkdownLine | undefined, later: MarkdownLine | undefined): boolean {
  if (earlier?.kind !== "prose" || later?.kind !== "prose" || LIST_ITEM.test(later.raw)) return false;
  return QUOTE_DEPTH.exec(earlier.raw)?.[0].split(">").length === QUOTE_DEPTH.exec(later.raw)?.[0].split(">").length;
}

function spansLines(lines: readonly MarkdownLine[], index: number): ProseFinding | undefined {
  const line = lines[index];
  if (line === undefined) return undefined;
  const next = lines[index + 1];
  const previous = lines[index - 1];
  const forward = next !== undefined && continues(line, next) && endsMidSentence(line, next);
  const back = previous !== undefined && continues(previous, line) && endsMidSentence(previous, line);
  if (!forward && !back) return undefined;
  return { line: line.line, message: `carries ${RUN_ON.refuses}. ${RUN_ON.instead}` };
}

export function proseFindings(text: string, reader: Reader, within?: ReadonlySet<number>): readonly ProseFinding[] {
  const lines = scanMarkdown(text);
  return lines.flatMap((line, index) => {
    if ((within !== undefined && !within.has(line.line)) || !JUDGED_KINDS.has(line.kind)) return [];
    const prose = line.kind === "prose";
    const sentences = [
      prose && SECOND_SENTENCE.readers.includes(reader) ? secondSentence(line) : undefined,
      prose && RUN_ON.readers.includes(reader) ? spansLines(lines, index) : undefined,
    ];
    return [...ruleFindings(line, reader), ...sentences.filter((finding) => finding !== undefined)];
  });
}

export function proseRefused(repositoryPath: string, text: string, within?: ReadonlySet<number>): string[] {
  const reader = readerOf(repositoryPath);
  if (reader === undefined) return [];
  return proseFindings(text, reader, within).map(({ line, message }) => `${repositoryPath}:${line} ${message}`);
}
