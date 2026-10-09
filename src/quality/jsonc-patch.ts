type Key = string | number;

type Entry = { readonly key: Key; readonly start: number; readonly node: Tree; readonly comma: number | undefined };

type Container = { readonly kind: "object" | "array"; readonly start: number; readonly end: number; readonly entries: readonly Entry[] };

type Tree = Container | { readonly kind: "scalar"; readonly start: number; readonly end: number; readonly value: unknown };

type Edit = { readonly start: number; readonly end: number; readonly text: string };

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

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function indentAt(text: string, at: number): string {
  const line = text.slice(text.lastIndexOf("\n", at - 1) + 1, at);
  return line.slice(0, line.length - line.trimStart().length);
}

function serialized(value: unknown, indent: string): string {
  return JSON.stringify(value, null, 2).replaceAll("\n", `\n${indent}`);
}

function member([key, value]: readonly [Key, unknown], indent: string): string {
  return typeof key === "string" ? `${JSON.stringify(key)}: ${serialized(value, indent)}` : serialized(value, indent);
}

function entryEnd({ node, comma }: Entry): number {
  return comma === undefined ? node.end : comma + 1;
}

function blankFrom(text: string, at: number, step: 1 | -1): number {
  let edge = at;
  while (/\s/.test(text.charAt(step === 1 ? edge : edge - 1))) edge += step;
  return edge;
}

function removedRun(text: string, entries: readonly Entry[], first: Entry, last: Entry): readonly Edit[] {
  const after = entries[entries.indexOf(last) + 1];
  if (after !== undefined) return [{ start: first.start, end: blankFrom(text, entryEnd(last), 1), text: "" }];
  const span = { start: blankFrom(text, first.start, -1), end: entryEnd(last), text: "" };
  const before = entries[entries.indexOf(first) - 1];
  if (before?.comma === undefined || last.comma !== undefined) return [span];
  return [{ start: before.comma, end: before.comma + 1, text: "" }, span];
}

function removals(text: string, { entries }: Container, removed: readonly number[]): readonly Edit[] {
  return removed
    .filter((index) => !removed.includes(index - 1))
    .flatMap((index) => {
      let last = index;
      while (removed.includes(last + 1)) last += 1;
      const [first, end] = [entries[index], entries[last]];
      return first === undefined || end === undefined ? [] : removedRun(text, entries, first, end);
    });
}

function insertion(text: string, { start, end }: Container, last: Entry | undefined, added: readonly (readonly [Key, unknown])[]): Edit {
  if (last === undefined) {
    const indent = indentAt(text, start);
    const members = added.map((one) => `\n${indent}  ${member(one, `${indent}  `)}`).join(",");
    return { start: start + 1, end: end - 1, text: `${text.slice(start + 1, end - 1).trimEnd()}${members}\n${indent}` };
  }
  const indent = indentAt(text, last.start);
  const separator = text.slice(start, last.start).includes("\n") ? `,\n${indent}` : ", ";
  return { start: last.node.end, end: last.node.end, text: added.map((one) => `${separator}${member(one, indent)}`).join("") };
}

function containerEdits(text: string, tree: Container, next: unknown, wanted: ReadonlyMap<Key, unknown>): readonly Edit[] {
  const removed = tree.entries.flatMap(({ key }, index) => (wanted.has(key) ? [] : [index]));
  const added = [...wanted].filter(([key]) => !tree.entries.some((entry) => entry.key === key));
  if (removed.length === tree.entries.length && removed.length > 0 && added.length > 0) {
    return [{ start: tree.start, end: tree.end, text: serialized(next, indentAt(text, tree.start)) }];
  }
  const kept = tree.entries.filter(({ key }) => wanted.has(key));
  const changed = kept.flatMap(({ key, node }) => edits(text, node, wanted.get(key)));
  return [...changed, ...removals(text, tree, removed), ...(added.length === 0 ? [] : [insertion(text, tree, kept.at(-1), added)])];
}

function edits(text: string, tree: Tree, next: unknown): readonly Edit[] {
  if (tree.kind === "object" && isRecord(next)) return containerEdits(text, tree, next, new Map(Object.entries(next)));
  if (tree.kind === "array" && Array.isArray(next)) return containerEdits(text, tree, next, new Map(next.entries()));
  if (tree.kind === "scalar" && tree.value === next) return [];
  return [{ start: tree.start, end: tree.end, text: serialized(next, indentAt(text, tree.start)) }];
}

// The text parses as JSONC, and next is a JSON value.
export function patched(text: string, next: unknown): string {
  return edits(text, new Scanner(text).node(), next)
    .toSorted((one, other) => other.start - one.start || other.end - one.end)
    .reduce((out, { start, end, text: replacement }) => out.slice(0, start) + replacement + out.slice(end), text);
}
