import { expect, test } from "bun:test";
import { join } from "node:path";
import { consumerTrees, KIT_BIN, type KitTree } from "../lib/consumer-tree.ts";
import { findings } from "../lib/findings.ts";

const PRELUDE = "type Item = { readonly id: string };\ntype State = Record<string, Item>;\ndeclare const items: Item[];\ndeclare const custom: unknown;\ndeclare const customCollection: unknown;\n";

const COPY = "data-shape(no-reduce-accumulator-copy)";

const SPREAD = "oxc(no-accumulating-spread)";

const COPIES: readonly string[] = [
  "items.reduce((acc, item) => Object.assign({}, acc, { [item.id]: item }), {});",
  "items.reduceRight((acc, item) => Object.assign({}, acc, item), {});",
  "items.reduce((acc, item, index, array) => Object.assign({}, acc, item), {});",
  "items.reduce(acc => Object.assign({}, acc), {});",
  "items.reduce(function (acc, item) { return Object.assign({}, item, acc); }, {});",
  "items['reduce'](((acc, item) => Object['assign']({}, acc, item)), {});",
  "items.reduce((acc = {}, item) => Object.assign({}, acc, item), {});",
  "items.reduce((acc, item) => { const alias = acc; return Object.assign({}, alias, item); }, {});",
  "items.reduce((acc, item) => Object.assign({}, acc as State, item), {});",
  "items.reduce((acc, item) => { const next = Object.assign({}, acc); next[item.id] = item; return next; }, {});",
  "items.reduce((acc, item) => acc.concat([item]), []);",
  "items.reduceRight((acc, item, index) => acc['concat']([item]), [] as Item[]);",
  "items.reduce((acc, item) => { const next = acc.slice(); next.push(item); return next; }, []);",
  "items.reduce((acc, item) => { const alias = acc; return alias.concat(item); }, []);",
  "const initial = []; items.reduce((acc, item) => acc.concat(item), initial);",
  "items.reduce((acc, item) => { const next = Array.from(acc); next.push(item); return next; }, []);",
  "items.reduce((acc, item) => acc.toSpliced(acc.length, 0, item), []);",
  "items.reduce((acc, item) => acc.toSorted(), []);",
  "items.reduce((acc, item) => acc.toReversed(), []);",
  "items.reduce((acc, item) => acc.with(0, item), []);",
];

const PASSES: readonly string[] = [
  "items.reduce((acc, item) => { acc.push(item); return acc; }, []);",
  "items.reduce((acc, item) => Object.assign(acc, item), {});",
  "items.reduce((acc, item) => Object.assign(acc, acc, item), {});",
  "items.reduce((acc, item) => { acc[item.id] = { ...item }; return acc; }, {});",
  "items.reduce((acc, item) => { acc.push(Object.assign({}, item)); return acc; }, []);",
  "items.reduce((acc, item) => { acc.push(item.slice()); return acc; }, []);",
  "items.reduce((acc, item) => acc.concat(item), '');",
  "items.reduce((acc, item) => acc.concat(item), customCollection);",
  "function copy(acc) { return Object.assign({}, acc); }",
  "items.map((acc, item) => Object.assign({}, acc));",
  "items.reduce((acc, item) => { function copy(acc) { return Object.assign({}, acc); } return acc; }, {});",
  "items.reduce((acc, item) => { const snapshot = () => Object.assign({}, acc); return acc; }, {});",
  "items.reduce((acc, item) => { { const acc = {}; Object.assign({}, acc); } return acc; }, {});",
  "const Object = custom; items.reduce((acc, item) => Object.assign({}, acc), {});",
  "function run(Object) { return items.reduce((acc, item) => Object.assign({}, acc), {}); }",
  "const Array = custom; items.reduce((acc, item) => Array.from(acc), []);",
  "items.reduce((acc, item) => { let alias = acc; alias = item; return Object.assign({}, alias); }, {});",
];

const SPREADS: readonly string[] = [
  "items.reduce((acc, item) => [...acc, item], []);",
  "items.reduce((acc, item) => ({ ...acc, [item.id]: item }), {});",
];

const BOUNDED_COPY = "items.reduce((acc, item) => Object.assign({}, acc, { count: acc.count + 1, last: item.id }), { count: 0, last: '' });";

const GROWING_COPY = `export function ids(items: readonly { readonly id: string }[]): string[] {
  return items.reduce<string[]>((acc, item) => {
    const next = acc.slice();
    next.push(item.id);
    return next;
  }, []);
}
`;

const GROWING_IN_PLACE = `export function ids(items: readonly { readonly id: string }[]): string[] {
  return items.reduce<string[]>((acc, item) => {
    acc.push(item.id);
    return acc;
  }, []);
}
`;

const consumerTree = consumerTrees("checks-reduce-copy-consumer-");

function caseFile(kind: string, index: number): string {
  return `src/${kind}-${index}.ts`;
}

async function putCases(tree: KitTree, kind: string, cases: readonly string[]): Promise<void> {
  for (const [index, code] of cases.entries()) await tree.put(caseFile(kind, index), `${PRELUDE}${code}\nexport {};\n`);
}

async function reduceFindings(tree: KitTree): Promise<ReadonlyMap<string, readonly string[]>> {
  const { text } = await tree.run(join(KIT_BIN, "oxlint"), ["-f", "unix", "src"]);
  return findings(text, /^(\S+?):\d+:\d+: .*\[Error\/(data-shape\(no-reduce-accumulator-copy\)|oxc\(no-accumulating-spread\))\]$/gm);
}

function expected(kind: string, cases: readonly string[], rule: string): readonly (readonly [string, readonly string[]])[] {
  return cases.map((_, index) => [caseFile(kind, index), [rule]]);
}

test(
  "the base refuses each reduce accumulator copy and spread once, and stays silent on a string accumulator, a shadowed Object or Array, a reassigned alias and a copy inside a nested function",
  async () => {
    const tree = await consumerTree({ paths: ["scripts/**/*.ts"], include: ["src/**/*.ts"], types: [] });
    await putCases(tree, "copy", COPIES);
    await putCases(tree, "pass", PASSES);
    await putCases(tree, "spread", SPREADS);
    await putCases(tree, "bounded", [BOUNDED_COPY]);
    expect(await reduceFindings(tree)).toEqual(
      new Map([
        ...expected("copy", COPIES, COPY),
        ...expected("spread", SPREADS, SPREAD),
        ...expected("bounded", [BOUNDED_COPY], COPY),
      ]),
    );
  },
  180_000,
);

test(
  "a growing accumulator copied with slice fails the base, and the same reduce pushing into the accumulator passes rather than being reported",
  async () => {
    const tree = await consumerTree({ paths: ["scripts/**/*.ts"], include: ["src/**/*.ts"], types: [] });
    await tree.put("src/ids.ts", GROWING_COPY);
    expect(await reduceFindings(tree)).toEqual(new Map([["src/ids.ts", [COPY]]]));
    await tree.put("src/ids.ts", GROWING_IN_PLACE);
    expect(await reduceFindings(tree)).toEqual(new Map());
  },
  180_000,
);
