import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Schema } from "effect";
import { Parser } from "commonmark";
import { BINS_PAGE, GATE_PAGES, MANIFEST } from "../../scripts/doc-blocks.ts";
import { parseOutline } from "../../src/docs/doc-outline.ts";
import { base as oxlintBase } from "../../src/quality/presets/oxlint.ts";

const CHECKOUT = resolve(import.meta.dir, "..", "..");
const SECTIONS = ["What it checks", "What it reads", "Arguments", "Exit codes", "Sample output", "When it runs"];

function read(file: string): string {
  return readFileSync(resolve(CHECKOUT, file), "utf8");
}

function visibleDestinations(text: string): readonly string[] {
  const walker = new Parser().parse(text).walker();
  const destinations: string[] = [];
  for (let step = walker.next(); step !== null; step = walker.next()) {
    if (step.entering && step.node.type === "link") {
      const destination = step.node.destination;
      if (destination !== null) destinations.push(destination);
    }
  }
  return destinations;
}

function visibleCode(text: string): ReadonlySet<string> {
  const walker = new Parser().parse(text).walker();
  const codes = new Set<string>();
  for (let step = walker.next(); step !== null; step = walker.next()) {
    if (step.entering && step.node.type === "code") {
      const literal = step.node.literal;
      if (literal !== null) codes.add(literal);
    }
  }
  return codes;
}

const Manifest = Schema.Struct({ bin: Schema.Record(Schema.String, Schema.String) });
const manifest = Schema.decodeSync(Schema.fromJsonString(Manifest))(read(MANIFEST));
const bins = Object.keys(manifest.bin);

test("docs/gates holds one page per bin, named for it", () => {
  expect(readdirSync(resolve(CHECKOUT, GATE_PAGES)).toSorted()).toEqual(bins.map((bin) => bin + ".md").toSorted());
});

test("each bin page is titled for the bin and carries the sections a reader looks a bin up for, in order", () => {
  const outlines = bins.map((bin) => {
    const { headings, sections } = parseOutline(read(GATE_PAGES + "/" + bin + ".md"));
    return { title: headings[0]?.title, sections: sections.map(({ heading }) => heading.title).filter((title) => SECTIONS.includes(title)) };
  });
  expect(outlines).toEqual(bins.map((bin) => ({ title: bin, sections: SECTIONS })));
});

test("the README links the bins page and the bins page links every bin page, so a new bin is two clicks from the front door", () => {
  const readmeTargets = visibleDestinations(read("README.md"));
  const pageTargets = visibleDestinations(read(BINS_PAGE));
  expect({
    readme: readmeTargets.includes(BINS_PAGE),
    unlinked: bins.filter((bin) => !pageTargets.includes("gates/" + bin + ".md")),
  }).toEqual({ readme: true, unlinked: [] });
});

function unnamedIn(page: string, names: readonly string[]): string[] {
  const codes = visibleCode(read(page));
  return names.filter((name) => !codes.has(name));
}

test("the TypeScript rules page names each category and rule the oxlint base sets", () => {
  const names = [...Object.keys(oxlintBase.categories ?? {}), ...Object.keys(oxlintBase.rules ?? {})];
  expect(unnamedIn("docs/configs/typescript-rules.md", names)).toEqual([]);
});

const DependencyBase = Schema.Struct({ forbidden: Schema.Array(Schema.Struct({ name: Schema.String })) });

test("the dependency rules page names each rule the dependency-cruiser base carries", async () => {
  const base = Schema.decodeUnknownSync(DependencyBase)((await import(resolve(CHECKOUT, "dependency-cruiser.config.js"))).default);
  expect(unnamedIn("docs/configs/dependency-rules.md", base.forbidden.map(({ name }) => name))).toEqual([]);
});
