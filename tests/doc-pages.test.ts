import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Schema } from "effect";
import kitOxlint from "../oxlintrc.json" with { type: "json" };
import { GATE_PAGES, MANIFEST } from "../scripts/doc-blocks.ts";
import { parseOutline } from "../scripts/doc-outline.ts";

const CHECKOUT = resolve(import.meta.dir, "..");
const SECTIONS = ["What it checks", "What it reads", "Arguments", "Exit codes", "Sample output", "Opting out"];

function read(file: string): string {
  return readFileSync(resolve(CHECKOUT, file), "utf8");
}

const Manifest = Schema.Struct({ bin: Schema.Record(Schema.String, Schema.String) });
const manifest = Schema.decodeSync(Schema.fromJsonString(Manifest))(read(MANIFEST));
const bins = Object.keys(manifest.bin);

test("docs/gates holds one page per bin, named for it", () => {
  expect(readdirSync(resolve(CHECKOUT, GATE_PAGES)).toSorted()).toEqual(bins.map((bin) => `${bin}.md`).toSorted());
});

test("each bin's page is titled for the bin and carries the sections a reader looks a bin up for, in order", () => {
  const outlines = bins.map((bin) => {
    const { headings, sections } = parseOutline(read(`${GATE_PAGES}/${bin}.md`));
    return { title: headings[0]?.title, sections: sections.map(({ heading }) => heading.title).filter((title) => SECTIONS.includes(title)) };
  });
  expect(outlines).toEqual(bins.map((bin) => ({ title: bin, sections: SECTIONS })));
});

test("the README links every bin's page, so a new bin reaches the front door", () => {
  const readme = read("README.md");
  expect(bins.filter((bin) => !readme.includes(`](${GATE_PAGES}/${bin}.md)`))).toEqual([]);
});

function unnamedOn(page: string, names: readonly string[]): string[] {
  const text = read(page);
  return names.filter((name) => !text.includes(`\`${name}\``));
}

test("the TypeScript rules page names each category and rule the oxlint base sets", () => {
  const names = [...Object.keys(kitOxlint.categories), ...Object.keys(kitOxlint.rules)];
  expect(unnamedOn("docs/configs/typescript-rules.md", names)).toEqual([]);
});

const DependencyBase = Schema.Struct({ forbidden: Schema.Array(Schema.Struct({ name: Schema.String })) });

test("the dependency rules page names each rule the dependency-cruiser base carries", async () => {
  const base = Schema.decodeUnknownSync(DependencyBase)((await import(resolve(CHECKOUT, "dependency-cruiser.config.js"))).default);
  expect(unnamedOn("docs/configs/dependency-rules.md", base.forbidden.map(({ name }) => name))).toEqual([]);
});
