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

const consumerTree = consumerTrees("checks-data-shape-consumer-");

test(
  "data-shape stays silent on a parameter that may be mutated, a domain type and an extended interface, and reports a readonly callee and a true twin",
  async () => {
    const tree = await consumerTree({ paths: ["scripts/**/*.ts"], include: ["src/**/*.ts"], types: [] });
    await tree.put("src/walker.ts", ACCUMULATOR_WALKER);
    await tree.put("src/queue.ts", PARAMETER_PROPERTY);
    await tree.put("src/count.ts", READONLY_CALLEE);
    await tree.put("src/event.ts", DOMAIN_TYPE);
    await tree.put("src/stamp.ts", TRUE_TWIN);
    await tree.put("src/label.ts", EXTENDED_INTERFACE);
    const { text } = await tree.run(join(KIT_BIN, "oxlint"), ["--type-aware", "-f", "unix", "src"]);
    expect(findings(text, /^(\S+?):\d+:\d+: .*\[Error\/([^\]]+)\]$/gm)).toEqual(
      new Map([
        ["src/count.ts", ["data-shape(readonly-collection-param)"]],
        ["src/stamp.ts", ["data-shape(schema-twin)"]],
      ]),
    );
  },
  180_000,
);
