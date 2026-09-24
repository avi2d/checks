import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Schema } from "effect";
import { parseOutline } from "../scripts/doc-outline.ts";

const CHECKOUT = resolve(import.meta.dir, "..");
const GATE_PAGES = "docs/gates";
const SECTIONS = ["What it checks", "What it reads", "Arguments", "Exit codes", "Sample output", "Opting out"];

const Manifest = Schema.Struct({ bin: Schema.Record(Schema.String, Schema.String) });
const bins = Object.keys(Schema.decodeUnknownSync(Schema.fromJsonString(Manifest))(readFileSync(resolve(CHECKOUT, "package.json"), "utf8")).bin);

function page(bin: string): string {
  return readFileSync(resolve(CHECKOUT, GATE_PAGES, `${bin}.md`), "utf8");
}

test("docs/gates holds one page per bin, named for it", () => {
  expect(readdirSync(resolve(CHECKOUT, GATE_PAGES)).toSorted()).toEqual(bins.map((bin) => `${bin}.md`).toSorted());
});

test("each bin's page is titled for the bin and carries the sections a reader looks a bin up for, in order", () => {
  const outlines = bins.map((bin) => {
    const { headings, sections } = parseOutline(page(bin));
    return { title: headings[0]?.title, sections: sections.map(({ heading }) => heading.title).filter((title) => SECTIONS.includes(title)) };
  });
  expect(outlines).toEqual(bins.map((bin) => ({ title: bin, sections: SECTIONS })));
});
