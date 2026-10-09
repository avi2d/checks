type Key = string | number;

type Entry = { readonly key: Key; readonly start: number; readonly node: Tree; readonly comma: number | undefined };

type Container = { readonly kind: "object" | "array"; readonly start: number; readonly end: number; readonly entries: readonly Entry[] };

type Tree = Container | { readonly kind: "scalar"; readonly start: number; readonly end: number; readonly value: unknown };

type Edit = { readonly start: number; readonly end: number; readonly text: string };

export type Step = string | Readonly<Record<string, unknown>>;

type Reached = { readonly container: Container; readonly entry: Entry } | { readonly container: Container; readonly missing: readonly [Step, ...Step[]] };

const SCALAR_END = /[\s,:\]}/]/;

class Scanner {
  readonly text: string;
  at = 0;

  constructor(text: string) {
    this.text = text;
  }

  blank(): void {
    for (;;) {
      while (/\s/.test(this.text.charAt(this.at))) this.at += 1;
      if (this.text.startsWith("//", this.at)) this.at = this.text.includes("\n", this.at) ? this.text.indexOf("\n", this.at) : this.text.length;
      else if (this.text.startsWith("/*", this.at)) this.at = this.text.indexOf("*/", this.at + 2) + 2;
      else return;
    }
  }

  quoted(): string {
    const start = this.at;
    const quote = this.text.charAt(start);
    this.at += 1;
    while (this.at < this.text.length && this.text.charAt(this.at) !== quote) this.at += this.text.charAt(this.at) === "\\" ? 2 : 1;
    this.at += 1;
    return this.text.slice(start, this.at);
  }

  scalar(): Tree {
    const start = this.at;
    const opening = this.text.charAt(start);
    if (opening === '"' || opening === "'") this.quoted();
    else while (this.at < this.text.length && !SCALAR_END.test(this.text.charAt(this.at))) this.at += 1;
    return { kind: "scalar", start, end: this.at, value: Bun.JSONC.parse(this.text.slice(start, this.at)) };
  }

  container(kind: Container["kind"]): Container {
    const start = this.at;
    const close = kind === "object" ? "}" : "]";
    const entries: Entry[] = [];
    this.at += 1;
    for (this.blank(); this.at < this.text.length && this.text.charAt(this.at) !== close; this.blank()) {
      const entryStart = this.at;
      const key = kind === "object" ? this.member() : entries.length;
      const node = this.node();
      this.blank();
      const comma = this.text.charAt(this.at) === "," ? this.at : undefined;
      if (comma !== undefined) this.at += 1;
      entries.push({ key, start: entryStart, node, comma });
    }
    this.at += 1;
    return { kind, start, end: this.at, entries };
  }

  member(): string {
    const key = String(Bun.JSONC.parse(this.quoted()));
    this.blank();
    this.at += 1;
    return key;
  }

  node(): Tree {
    this.blank();
    const opening = this.text.charAt(this.at);
    if (opening === "{") return this.container("object");
    if (opening === "[") return this.container("array");
    return this.scalar();
  }
}

function valueOf(text: string, tree: Tree): unknown {
  return tree.kind === "scalar" ? tree.value : Bun.JSONC.parse(text.slice(tree.start, tree.end));
}

function holds(text: string, tree: Tree, match: Readonly<Record<string, unknown>>): boolean {
  if (tree.kind !== "object") return false;
  return Object.entries(match).every(([key, wanted]) => {
    const member = tree.entries.findLast((entry) => entry.key === key);
    return member !== undefined && Bun.deepEquals(valueOf(text, member.node), wanted);
  });
}

function childOf(text: string, container: Container, step: Step): Entry | undefined {
  if (typeof step === "string") return container.kind === "object" ? container.entries.findLast(({ key }) => key === step) : undefined;
  return container.kind === "array" ? container.entries.find(({ node }) => holds(text, node, step)) : undefined;
}

// Every step but the last reaches a container, an object for a key and an array for a match.
function reached(text: string, path: readonly [Step, ...Step[]]): Reached | undefined {
  let container = new Scanner(text).node();
  let steps = path;
  for (;;) {
    if (container.kind === "scalar") return undefined;
    const [step, ...tail] = steps;
    const entry = childOf(text, container, step);
    if (entry === undefined) return { container, missing: steps };
    const [next, ...after] = tail;
    if (next === undefined) return { container, entry };
    container = entry.node;
    steps = [next, ...after];
  }
}

function childValue(step: Step, tail: readonly Step[], value: unknown): unknown {
  const [next, ...after] = tail;
  const inner = next === undefined ? value : typeof next === "string" ? { [next]: childValue(next, after, value) } : [childValue(next, after, value)];
  return typeof step === "string" ? inner : Object.assign({}, step, inner);
}

function indentAt(text: string, at: number): string {
  const line = text.slice(text.lastIndexOf("\n", at - 1) + 1, at);
  return line.slice(0, line.length - line.trimStart().length);
}

function serialized(value: unknown, indent: string): string {
  return JSON.stringify(value, null, 2).replaceAll("\n", `\n${indent}`);
}

function spacesFrom(text: string, at: number, step: 1 | -1): number {
  let edge = at;
  while (/[ \t]/.test(text.charAt(step === 1 ? edge : edge - 1))) edge += step;
  return edge;
}

function newlineAt(text: string, at: number): number | undefined {
  if (text.startsWith("\r\n", at)) return 2;
  return text.charAt(at) === "\n" ? 1 : undefined;
}

function lineEndAfter(text: string, at: number): number | undefined {
  let edge = spacesFrom(text, at, 1);
  for (;;) {
    if (text.startsWith("//", edge)) edge = text.includes("\n", edge) ? text.indexOf("\n", edge) : text.length;
    else if (text.startsWith("/*", edge)) edge = spacesFrom(text, text.indexOf("*/", edge + 2) + 2, 1);
    else return newlineAt(text, edge) === undefined ? undefined : edge;
  }
}

function insertion(text: string, { start, end, entries }: Container, step: Step, value: unknown): Edit {
  const key = typeof step === "string" ? `${JSON.stringify(step)}: ` : "";
  const last = entries.at(-1);
  if (last === undefined) {
    const indent = indentAt(text, start);
    return { start: start + 1, end: end - 1, text: `${text.slice(start + 1, end - 1).trimEnd()}\n${indent}  ${key}${serialized(value, `${indent}  `)}\n${indent}` };
  }
  const indent = indentAt(text, last.start);
  const member = `${key}${serialized(value, indent)}${last.comma === undefined ? "" : ","}`;
  const separated = last.comma === undefined ? "," : "";
  const lineEnd = lineEndAfter(text, last.comma === undefined ? last.node.end : last.comma + 1);
  const until = lineEnd ?? (last.comma === undefined ? last.node.end : last.comma + 1);
  return { start: last.node.end, end: until, text: `${separated}${text.slice(last.node.end, until)}${lineEnd === undefined ? " " : `\n${indent}`}${member}` };
}

function removal(text: string, { entries }: Container, entry: Entry): readonly Edit[] {
  const index = entries.indexOf(entry);
  const followed = index < entries.length - 1;
  const end = entry.comma === undefined ? entry.node.end : entry.comma + 1;
  const lineStart = spacesFrom(text, entry.start, -1);
  const lineEnd = spacesFrom(text, end, 1);
  const newline = newlineAt(text, lineEnd);
  const before = entries[index - 1]?.comma;
  const comma = !followed && entry.comma === undefined && before !== undefined ? [{ start: before, end: before + 1, text: "" }] : [];
  if (newline !== undefined && (lineStart === 0 || text.charAt(lineStart - 1) === "\n")) return [...comma, { start: lineStart, end: lineEnd + newline, text: "" }];
  return [...comma, followed ? { start: entry.start, end: lineEnd, text: "" } : { start: lineStart, end, text: "" }];
}

function applied(text: string, edits: readonly Edit[]): string {
  return edits.toSorted((one, other) => other.start - one.start).reduce((out, { start, end, text: replacement }) => out.slice(0, start) + replacement + out.slice(end), text);
}

// The text parses as JSONC, and value is a JSON value.
export function withMember(text: string, path: readonly [Step, ...Step[]], value: unknown): string {
  const found = reached(text, path);
  if (found === undefined) return text;
  if ("missing" in found) {
    const [step, ...tail] = found.missing;
    return applied(text, [insertion(text, found.container, step, childValue(step, tail, value))]);
  }
  const { node, start } = found.entry;
  if (Bun.deepEquals(valueOf(text, node), value)) return text;
  return applied(text, [{ start: node.start, end: node.end, text: serialized(value, indentAt(text, start)) }]);
}

// The text parses as JSONC.
export function withoutMember(text: string, path: readonly [Step, ...Step[]]): string {
  const found = reached(text, path);
  if (found === undefined || "missing" in found) return text;
  return applied(text, removal(text, found.container, found.entry));
}
