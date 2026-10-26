import { expect, test } from "bun:test";
import { join } from "node:path";
import { consumerTrees, KIT_BIN } from "./lib/consumer-tree.ts";
import { findings } from "./lib/findings.ts";

const ACCUMULATOR_WALKER = `type Tree = { readonly name: string; readonly children: readonly Tree[] };
function collect(tree: Tree, out: string[]): void {
  out.push(tree.name);
}
export function visit(tree: Tree, out: string[]): void {
  for (const child of tree.children) collect(child, out);
}
`;

const PARAMETER_PROPERTY = `export class Queue {
  constructor(private readonly items: string[]) {}
  add(item: string): void {
    this.items.push(item);
  }
}
`;

const READONLY_CALLEE = `function size(items: readonly string[]): number {
  return items.length;
}
export function count(items: string[]): number {
  return size(items);
}
`;

const DOMAIN_TYPE = `import { Schema } from "effect";
export const RawEvent = Schema.Struct({ createdAt: Schema.String, name: Schema.String });
export type Event = { readonly createdAt: Date; readonly name: string };
`;

const TRUE_TWIN = `import { Schema } from "effect";
export const RawStamp = Schema.Struct({ createdAt: Schema.String, name: Schema.String });
export type Stamp = { readonly createdAt: string; readonly name: string };
`;

const EXTENDED_INTERFACE = `import { Schema } from "effect";
export const RawLabel = Schema.Struct({ code: Schema.String, name: Schema.String });
interface Owned {
  readonly owner: string;
}
export interface Label extends Owned {
  readonly code: string;
  readonly name: string;
}
`;

const SWAP = `export function shuffle(items: string[], pick: (bound: number) => number): void {
  for (let index = items.length - 1; index > 0; index--) {
    const other = pick(index);
    [items[index], items[other]] = [items[other], items[index]];
  }
}
`;

const COMPUTED_PUSH = `export function add(items: string[]): void {
  items["push"]("a");
}
`;

const JSX_PROP = `function TagList(props: { readonly tags: string[] }): string {
  return props.tags.join(",");
}
export function renderTags(tags: string[]): unknown {
  return <TagList tags={tags} />;
}
`;

const TAGGED_TWIN = `import { Schema } from "effect";
export const Created = Schema.TaggedStruct("Created", { id: Schema.String, at: Schema.Number });
export type CreatedEvent = { readonly _tag: "Created"; readonly id: string; readonly at: number };
`;

const TAGGED_PAYLOAD = `import { Schema } from "effect";
export const Deleted = Schema.TaggedStruct("Deleted", { id: Schema.String, at: Schema.Number });
export type DeletedInput = { readonly id: string; readonly at: number };
`;

const NARROWED_STRING = `import { Schema } from "effect";
export const Raw = Schema.Struct({ status: Schema.String, count: Schema.Number });
export type Parsed = { readonly status: "open" | "closed"; readonly count: number };
`;

const REFINED_DOMAIN_TYPE = `import { Schema } from "effect";
export const RawVisit = Schema.Struct({ at: Schema.String.check(Schema.isPattern(/^\\d{4}-/u)), name: Schema.String });
export type Visit = { readonly at: Date; readonly name: string };
`;

const REFINED_TWIN = `import { Schema } from "effect";
export const RawLibrary = Schema.Struct({ name: Schema.String.check(Schema.isMinLength(1)), size: Schema.Int.annotate({}) });
export type Library = { readonly name: string; readonly size: number };
`;

const BRANDED_PIPE = `import { Schema } from "effect";
export const User = Schema.Struct({ id: Schema.String.pipe(Schema.brand("UserId")), name: Schema.String });
export type NewUser = { readonly id: string; readonly name: string };
`;

const consumerTree = consumerTrees("checks-data-shape-consumer-");

test(
  "data-shape stays silent on a parameter that may be mutated, a domain type, an extended interface, a tagged payload, a narrowed string, a refined domain type and a branded pipe, and reports a readonly callee and true twins",
  async () => {
    const tree = await consumerTree({ paths: ["scripts/**/*.ts"], include: ["src/**/*.ts", "src/**/*.tsx"], types: [] });
    await tree.put("src/walker.ts", ACCUMULATOR_WALKER);
    await tree.put("src/queue.ts", PARAMETER_PROPERTY);
    await tree.put("src/count.ts", READONLY_CALLEE);
    await tree.put("src/event.ts", DOMAIN_TYPE);
    await tree.put("src/stamp.ts", TRUE_TWIN);
    await tree.put("src/label.ts", EXTENDED_INTERFACE);
    await tree.put("src/shuffle.ts", SWAP);
    await tree.put("src/add.ts", COMPUTED_PUSH);
    await tree.put("src/tags.tsx", JSX_PROP);
    await tree.put("src/created.ts", TAGGED_TWIN);
    await tree.put("src/deleted.ts", TAGGED_PAYLOAD);
    await tree.put("src/parsed.ts", NARROWED_STRING);
    await tree.put("src/visit.ts", REFINED_DOMAIN_TYPE);
    await tree.put("src/library.ts", REFINED_TWIN);
    await tree.put("src/user.ts", BRANDED_PIPE);
    const { text } = await tree.run(join(KIT_BIN, "oxlint"), ["--type-aware", "-f", "unix", "src"]);
    expect(findings(text, /^(\S+?):\d+:\d+: .*\[Error\/([^\]]+)\]$/gm)).toEqual(
      new Map([
        ["src/count.ts", ["data-shape(readonly-collection-param)"]],
        ["src/stamp.ts", ["data-shape(schema-twin)"]],
        ["src/created.ts", ["data-shape(schema-twin)"]],
        ["src/library.ts", ["data-shape(schema-twin)"]],
      ]),
    );
  },
  180_000,
);
