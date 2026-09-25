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

export type ProseRule = {
  readonly refuses: string;
  readonly example: string;
  readonly instead: string;
};

type MatchedRule = ProseRule & { readonly find: RegExp };

export const ADR_DIRECTORY = "docs/adr/";
export const DOCS_DIRECTORY = "docs/";
export const LIVING_NAMES: readonly string[] = ["README.md", "CONTRIBUTING.md"];
export const NEVER_LIVING: readonly string[] = ["CHANGELOG.md", "AGENTS.md", "CLAUDE.md"];
export const DATED_RECORD_EXAMPLES: readonly string[] = ["0001-", "2026-05-08-"];
const DATED_RECORD = /^\d{4}-/;

export function isLivingDoc(repositoryPath: string): boolean {
  const name = repositoryPath.slice(repositoryPath.lastIndexOf("/") + 1);
  if (NEVER_LIVING.includes(name) || DATED_RECORD.test(name) || repositoryPath.startsWith(ADR_DIRECTORY)) return false;
  return LIVING_NAMES.includes(name) || (repositoryPath.startsWith(DOCS_DIRECTORY) && name.endsWith(".md"));
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

function mask(raw: string, startsInComment: boolean): Masked {
  const out = raw.split("");
  const code: string[] = [];
  const links: string[] = [];
  const hide = (from: number, to: number, fill: string): void => {
    for (let at = from; at < to; at += 1) out[at] = fill;
  };
  let inComment = startsInComment;
  let at = 0;
  while (at < raw.length) {
    if (inComment) {
      const close = raw.indexOf("-->", at);
      const end = close < 0 ? raw.length : close + 3;
      hide(at, end, BLANK);
      inComment = close < 0;
      at = end;
      continue;
    }
    const rest = raw.slice(at);
    if (rest.startsWith("<!--")) {
      hide(at, at + 4, BLANK);
      inComment = true;
      at += 4;
      continue;
    }
    if (rest.startsWith("`")) {
      const run = runOf(raw, at, "`");
      const close = closingRun(raw, at + run, run);
      if (close >= 0) {
        code.push(raw.slice(at + run, close).trim());
        hide(at, close + run, HIDDEN);
        at = close + run;
      } else at += run;
      continue;
    }
    if (rest.startsWith("](")) {
      const end = destinationEnd(raw, at + 1);
      if (end >= 0) {
        links.push(targetOf(raw.slice(at + 2, end)));
        hide(at + 1, end + 1, HIDDEN);
        at = end + 1;
        continue;
      }
    }
    const hidden = hiddenAt(raw, at, rest);
    if (hidden !== undefined) {
      hide(at, at + hidden.length, hidden.fill);
      at += hidden.length;
      continue;
    }
    at += 1;
  }
  return { prose: out.join(""), code, links, inComment };
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

export function scanMarkdown(text: string): readonly MarkdownLine[] {
  const raws = text.split("\n").map((raw) => raw.replace(/\r$/, ""));
  const lines: MarkdownLine[] = [];
  let fence: string | undefined;
  let inComment = false;
  let inHtmlBlock = false;
  let frontMatter = raws[0] === "---";
  for (const [index, raw] of raws.entries()) {
    const line = index + 1;
    if (frontMatter) {
      frontMatter = index === 0 || (raw !== "---" && raw !== "...");
      lines.push(unread(line, raw, "front-matter"));
      continue;
    }
    if (fence !== undefined) {
      if (fenceCloses(raw, fence)) fence = undefined;
      lines.push(unread(line, raw, "code"));
      continue;
    }
    const opener = inComment ? undefined : fenceOpener(raw);
    if (opener !== undefined) {
      fence = opener;
      lines.push(unread(line, raw, "code"));
      continue;
    }
    const definition = inComment ? null : DEFINITION.exec(raw);
    if (definition !== null) {
      lines.push({ ...unread(line, raw, "definition"), links: [targetOf(definition[1] ?? "")] });
      continue;
    }
    const masked = mask(raw, inComment);
    inComment = masked.inComment;
    const kind = kindOf(raw, masked.prose);
    // An HTML block runs to the next blank line, whatever its later lines open with.
    inHtmlBlock = kind === "html" || (inHtmlBlock && kind !== "blank");
    lines.push({ line, kind: inHtmlBlock ? "html" : kind, raw, prose: masked.prose, code: masked.code, links: masked.links });
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

const RULES: readonly MatchedRule[] = [
  { refuses: "an em dash", example: code("—"), instead: SEPARATOR_INSTEAD, find: /—/g },
  { refuses: "an en dash", example: code("–"), instead: SEPARATOR_INSTEAD, find: /–/g },
  {
    refuses: "a parenthesis other than the plural `(s)`",
    example: code("("),
    instead: "Make the aside its own sentence, or set it off with commas",
    find: /\((?!s\))/g,
  },
  {
    refuses: "a hyphen used as a dash",
    example: `${code("a - b")} or ${code("a -- b")}`,
    instead: SEPARATOR_INSTEAD,
    find: /(?<=[^\s|]) -{1,3} (?=[^\s|])/g,
  },
  { refuses: "a semicolon", example: code(";"), instead: "Use two sentences", find: /;/g },
  {
    refuses: "a promise about the future",
    example: PROMISES.map(([shows]) => code(shows)).join(", "),
    instead: "Say what is true now",
    find: new RegExp(PROMISES.map(([, pattern]) => String.raw`\b${pattern}\b`).join("|"), "gi"),
  },
  {
    refuses: "a sentence that opens by talking about the page",
    example: code("This page explains"),
    instead: "Talk directly about the subject",
    find: /(?<=^\s*|[.!?:]\s+)(?:this|the following|in this) (?:page|topic|section|document|doc|guide|tutorial|article|readme|file|chapter)\b(?: \w+)?/gi,
  },
];

const SECOND_SENTENCE: ProseRule = {
  refuses: "a second sentence on one line",
  example: code("It builds. It ships."),
  instead: "Start it on its own line",
};

const RUN_ON: ProseRule = {
  refuses: "a sentence that runs across lines",
  example: `${code("It builds")} with ${code("and ships.")} on the next line`,
  instead: "Join the sentence onto one line",
};

export const PROSE_RULES: readonly ProseRule[] = [...RULES.map(({ refuses, example, instead }) => ({ refuses, example, instead })), SECOND_SENTENCE, RUN_ON];

const JUDGED_KINDS: ReadonlySet<LineKind> = new Set(["prose", "heading", "table", "html"]);

function ruleFindings(line: MarkdownLine): ProseFinding[] {
  const body = bodyOf(line);
  return RULES.flatMap(({ refuses, instead, find }) =>
    [...body.matchAll(find)].map(([match]) => ({ line: line.line, message: `carries \`${match.trim()}\`, ${refuses}. ${instead}` })),
  );
}

const SENTENCE_BREAK = /(?<=[^\s.!?])[.!?]["'”’)\]*_]*\s+(?=[A-Z"“*_[\0])/g;
const ABBREVIATION = /\b(?:e\.g|i\.e|etc|vs|cf|approx|Mr|Mrs|Ms|Dr|St|No|Fig)$/i;
const SENTENCE_END = /[.!?:]["'”’)\]*_]*\s*$/;
const LIST_ITEM = /^(?:\s*>)*\s*(?:[-*+]|\d{1,9}[.)])(?:\s|$)/;
const QUOTE_DEPTH = /^(?:\s*>)*/;

function secondSentence(line: MarkdownLine): ProseFinding | undefined {
  const body = bodyOf(line);
  for (const match of body.matchAll(SENTENCE_BREAK)) {
    if (ABBREVIATION.test(body.slice(0, match.index))) continue;
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

export function proseFindings(text: string, within?: ReadonlySet<number>): readonly ProseFinding[] {
  const lines = scanMarkdown(text);
  return lines.flatMap((line, index) => {
    if ((within !== undefined && !within.has(line.line)) || !JUDGED_KINDS.has(line.kind)) return [];
    const sentences = line.kind === "prose" ? [secondSentence(line), spansLines(lines, index)] : [];
    return [...ruleFindings(line), ...sentences.filter((finding) => finding !== undefined)];
  });
}

export function proseRefused(repositoryPath: string, text: string, within?: ReadonlySet<number>): string[] {
  if (!isLivingDoc(repositoryPath)) return [];
  return proseFindings(text, within).map(({ line, message }) => `${repositoryPath}:${line} ${message}`);
}
