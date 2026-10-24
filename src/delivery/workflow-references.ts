import { fromProgram, shellWords, type Command } from "./shell-command.ts";

export type Workflow = {
  readonly path: string;
  readonly document: unknown;
  readonly text: string;
};

export type MissingReference = {
  readonly location: string;
  readonly fault: string;
};

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function workflowJobs(workflow: Workflow): readonly (readonly [string, Readonly<Record<string, unknown>>])[] {
  const jobs = isRecord(workflow.document) ? workflow.document["jobs"] : undefined;
  return isRecord(jobs) ? Object.entries(jobs).flatMap(([id, job]) => (isRecord(job) ? [[id, job] as const] : [])) : [];
}

export function names(value: unknown): readonly string[] | undefined {
  if (typeof value === "string") return [value];
  if (!Array.isArray(value)) return undefined;
  return value.filter((entry): entry is string => typeof entry === "string");
}

type Key = string | number;

type Target = { readonly name: string; readonly invocation: number };

type Piece = { readonly at: number; readonly text: string };

type Locator = (keys: readonly Key[], needle: string, fallback: string) => string;

// Lines from..to hold the node, and its child keys start at column.
type Node = { readonly from: number; readonly to: number; readonly column: number };

const WORKFLOWS = ".github/workflows";
const RELEASE_BINS = ["checks-release-pr", "checks-release-tag"];
const RELEASE_SOURCES = ["release-pr.ts", "release-tag.ts"];
const REUSABLE_PREFIX = "./.github/workflows/";
// GitHub substitutes an expression into the script before the shell reads it.
const EXPRESSION = /\$\{\{[\s\S]*?\}\}/g;

function isPathTo(word: string, files: readonly string[]): boolean {
  return files.some((file) => word.endsWith(`/${file}`));
}

function releaseArguments(program: Command): readonly string[] {
  const [head, target, entry] = program;
  if (head !== undefined && (RELEASE_BINS.includes(head) || isPathTo(head, RELEASE_BINS))) return program.slice(1);
  if (head === "bun" && target === "run" && entry !== undefined && (RELEASE_SOURCES.includes(entry) || isPathTo(entry, [...RELEASE_SOURCES, ...RELEASE_BINS]))) {
    return program.slice(3);
  }
  if (head === "bun" && target !== undefined && (RELEASE_SOURCES.includes(target) || isPathTo(target, [...RELEASE_SOURCES, ...RELEASE_BINS]))) {
    return program.slice(2);
  }
  return [];
}

// The stand-in for an expression keeps its length, so each invocation starts at its offset in run.
function literalTargets(run: string): readonly Target[] {
  return shellWords(run.replace(EXPRESSION, (expression) => `$${"_".repeat(expression.length - 1)}`)).flatMap((words) => {
    const invocation = words[0]?.start ?? 0;
    return releaseArguments(fromProgram(words.map(({ text }) => text)))
      .filter((name) => !name.includes("$"))
      .map((name) => ({ name, invocation }));
  });
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function indentOf(line: string): number {
  return line.length - line.trimStart().length;
}

function meaningful(line: string): boolean {
  const text = line.trim();
  return text !== "" && !text.startsWith("#");
}

function belongs(line: string, column: number): boolean {
  return !meaningful(line) || indentOf(line) > column || (indentOf(line) === column && line.trim().startsWith("-"));
}

function firstBodyLine(lines: readonly string[], from: number, to: number): string | undefined {
  return lines.slice(from + 1, to).find(meaningful);
}

function child(lines: readonly string[], node: Node, key: string): Node | undefined {
  const pattern = new RegExp(`^(\\s*(?:-\\s+)?)["']?${escapeRegExp(key)}["']?\\s*:(\\s|$)`);
  for (let at = node.from; at < node.to; at += 1) {
    if (pattern.exec(lines[at] ?? "")?.[1]?.length !== node.column) continue;
    let to = at + 1;
    while (to < node.to && belongs(lines[to] ?? "", node.column)) to += 1;
    const body = firstBodyLine(lines, at, to);
    return { from: at, to, column: body === undefined ? -1 : indentOf(body) };
  }
  return undefined;
}

function items(lines: readonly string[], node: Node): readonly Node[] {
  const column = indentOf(firstBodyLine(lines, node.from, node.to) ?? "");
  const starts: number[] = [];
  for (let at = node.from + 1; at < node.to; at += 1) {
    const line = lines[at] ?? "";
    if (meaningful(line) && indentOf(line) === column && line.trim().startsWith("-")) starts.push(at);
  }
  return starts.map((from, index) => {
    const to = starts[index + 1] ?? node.to;
    const inline = /^\s*-\s+(?=\S)/.exec(lines[from] ?? "");
    return { from, to, column: inline === null ? indentOf(firstBodyLine(lines, from, to) ?? "") : inline[0].length };
  });
}

function nodeAt(lines: readonly string[], keys: readonly Key[]): Node | undefined {
  return keys.reduce<Node | undefined>(
    (node, key) => (node === undefined ? undefined : typeof key === "number" ? items(lines, node)[key] : child(lines, node, key)),
    { from: 0, to: lines.length, column: 0 },
  );
}

const BLOCK_HEADER = /^[|>][1-9+-]*\s*(#.*)?$/;
const PLAIN_COMMENT = /(^|\s)#/;
const ESCAPES = new Map([
  ["0", "\0"], ["a", "\x07"], ["b", "\b"], ["t", "\t"], ["\t", "\t"], ["n", "\n"], ["v", "\v"], ["f", "\f"], ["r", "\r"], ["e", "\x1b"],
  [" ", " "], ['"', '"'], ["/", "/"], ["\\", "\\"], ["N", "\x85"], ["_", "\xa0"], ["L", "\u2028"], ["P", "\u2029"],
]);
const HEX_ESCAPES = new Map([["x", 2], ["u", 4], ["U", 8]]);

function rawPieces(lines: readonly string[], node: Node): readonly Piece[] {
  const head = lines[node.from] ?? "";
  const keyColumn = /^\s*(?:-\s+)?/.exec(head)?.[0].length ?? 0;
  return [
    { at: node.from, text: head.slice(head.indexOf(":") + 1).trim() },
    ...lines.slice(node.from + 1, node.to).map((line, index) => ({ at: node.from + 1 + index, text: indentOf(line) > keyColumn ? line.trim() : "" })),
  ];
}

function plainPieces(pieces: readonly Piece[]): readonly Piece[] {
  const decoded: Piece[] = [];
  for (const { at, text } of pieces) {
    const comment = PLAIN_COMMENT.exec(text);
    const content = comment === null ? text : text.slice(0, comment.index).trimEnd();
    decoded.push({ at, text: content });
    if (comment !== null && decoded.some((piece) => piece.text !== "")) break;
  }
  return decoded;
}

function escaped(text: string, at: number): { readonly text: string; readonly end: number } {
  const code = text.charAt(at + 1);
  const width = HEX_ESCAPES.get(code);
  if (width !== undefined) return { text: String.fromCodePoint(Number.parseInt(text.slice(at + 2, at + 2 + width), 16)), end: at + 2 + width };
  return { text: ESCAPES.get(code) ?? code, end: at + 2 };
}

function quotedPieces(pieces: readonly Piece[], quote: "'" | '"'): readonly Piece[] {
  const decoded: Piece[] = [];
  for (const [position, { at, text }] of pieces.entries()) {
    let content = "";
    let index = position === 0 ? 1 : 0;
    while (index < text.length) {
      const char = text.charAt(index);
      if (quote === "'" && char === "'" && text.charAt(index + 1) === "'") {
        content += "'";
        index += 2;
      } else if (char === quote) {
        return [...decoded, { at, text: content }];
      } else if (quote === '"' && char === "\\") {
        const escape = escaped(text, index);
        content += escape.text;
        index = escape.end;
      } else {
        content += char;
        index += 1;
      }
    }
    decoded.push({ at, text: content });
  }
  return decoded;
}

function quoteOf(text: string): "'" | '"' | undefined {
  return text.startsWith("'") ? "'" : text.startsWith('"') ? '"' : undefined;
}

// Each piece holds what its physical line adds to the value, without the folding between lines.
function scalarPieces(lines: readonly string[], node: Node): readonly Piece[] {
  const [head, ...body] = rawPieces(lines, node);
  if (head === undefined) return [];
  if (BLOCK_HEADER.test(head.text)) return body;
  const open = quoteOf(head.text);
  if (open !== undefined) return quotedPieces([head, ...body], open);
  if (head.text !== "" && !head.text.startsWith("#")) return plainPieces([head, ...body]);
  const first = body.findIndex((piece) => piece.text !== "" && !piece.text.startsWith("#"));
  const token = first === -1 ? undefined : quoteOf(body[first]?.text ?? "");
  return token === undefined ? plainPieces([head, ...body]) : quotedPieces(body.slice(first), token);
}

function scalarLine(lines: readonly string[], node: Node, value: string, offset: number): number {
  let line = node.from;
  let cursor = 0;
  for (const { at, text } of scalarPieces(lines, node)) {
    const start = text === "" ? -1 : value.indexOf(text, cursor);
    if (start === -1) continue;
    if (start > offset) break;
    line = at;
    cursor = start + text.length;
  }
  return line;
}

function releaseLocation(path: string, lines: readonly string[], keys: readonly Key[], run: string, target: Target, fallback: string): string {
  const node = nodeAt(lines, keys);
  return node === undefined ? `${path} ${fallback}` : `${path} line ${scalarLine(lines, node, run, target.invocation) + 1}`;
}

export function locate(path: string, lines: readonly string[]): Locator {
  const used = new Map<string, number>();
  return (keys, needle, fallback) => {
    const node = nodeAt(lines, keys);
    if (node === undefined) return `${path} ${fallback}`;
    const hits = lines.slice(node.from, node.to).flatMap((line, offset) => (line.includes(needle) ? [node.from + offset] : []));
    const at = hits.find((line) => line > (used.get(needle) ?? -1)) ?? hits[0] ?? node.from;
    used.set(needle, at);
    return `${path} line ${at + 1}`;
  };
}

export function workflowTitle(document: unknown): string | undefined {
  return isRecord(document) && typeof document["name"] === "string" ? document["name"] : undefined;
}

function missingNeeds(jobs: Readonly<Record<string, unknown>>, at: Locator): readonly MissingReference[] {
  return Object.entries(jobs).flatMap(([id, job]) => {
    if (!isRecord(job)) return [];
    return (names(job["needs"]) ?? []).flatMap((need) =>
      need in jobs ? [] : [{ location: at(["jobs", id, "needs"], need, `job ${id}`), fault: `job ${id} needs missing job ${need}` }],
    );
  });
}

function missingTarget(uses: string, paths: ReadonlySet<string>, at: Locator, keys: readonly Key[], fallback: string): MissingReference | undefined {
  return uses.startsWith(REUSABLE_PREFIX) && !paths.has(uses.slice(2))
    ? { location: at(keys, uses, fallback), fault: `names missing workflow ${uses.slice(2)}` }
    : undefined;
}

function missingJobRefs(
  id: string,
  job: unknown,
  paths: ReadonlySet<string>,
  at: Locator,
  path: string,
  lines: readonly string[],
): readonly MissingReference[] {
  if (!isRecord(job)) return [];
  const missing: MissingReference[] = [];
  if (typeof job["uses"] === "string") {
    const called = missingTarget(job["uses"], paths, at, ["jobs", id, "uses"], `job ${id}`);
    if (called !== undefined) missing.push(called);
  }
  const steps = job["steps"];
  if (!Array.isArray(steps)) return missing;
  steps.forEach((step: unknown, index) => {
    if (!isRecord(step)) return;
    const fallback = `job ${id} step ${index + 1}`;
    if (typeof step["uses"] === "string") {
      const used = missingTarget(step["uses"], paths, at, ["jobs", id, "steps", index, "uses"], fallback);
      if (used !== undefined) missing.push(used);
    }
    if (typeof step["run"] !== "string") return;
    for (const target of literalTargets(step["run"])) {
      if (!paths.has(`${WORKFLOWS}/${target.name}`)) {
        const location = releaseLocation(path, lines, ["jobs", id, "steps", index, "run"], step["run"], target, fallback);
        missing.push({ location, fault: `names missing workflow ${target.name}` });
      }
    }
  });
  return missing;
}

// GitHub names a workflow without a name by its path from the repository root.
export function findMissingWorkflows(workflows: readonly Workflow[]): readonly MissingReference[] {
  const paths = new Set(workflows.map((workflow) => workflow.path));
  const titles = new Set(workflows.map((workflow) => workflowTitle(workflow.document) ?? workflow.path));
  return workflows.flatMap((workflow) => {
    const missing: MissingReference[] = [];
    const lines = workflow.text.split("\n");
    const at = locate(workflow.path, lines);
    const jobs = isRecord(workflow.document) ? workflow.document["jobs"] : undefined;
    if (isRecord(jobs)) {
      missing.push(...missingNeeds(jobs, at));
      for (const [id, job] of Object.entries(jobs)) missing.push(...missingJobRefs(id, job, paths, at, workflow.path, lines));
    }
    const on = isRecord(workflow.document) ? workflow.document["on"] : undefined;
    const watched = isRecord(on) ? on["workflow_run"] : undefined;
    if (isRecord(watched)) {
      for (const entry of names(watched["workflows"]) ?? []) {
        if (!titles.has(entry)) {
          missing.push({ location: at(["on", "workflow_run", "workflows"], entry, "on workflow_run"), fault: `names missing workflow ${entry}` });
        }
      }
    }
    return missing;
  });
}

export function formatMissingReport(faults: readonly MissingReference[]): string {
  return [
    `ci-wiring: ${faults.length} reference(s) name a missing workflow or job:`,
    ...faults.map(({ location, fault }) => `  ${location}: ${fault}`),
  ].join("\n");
}
