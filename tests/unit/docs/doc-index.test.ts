import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { indexState, writtenIndex } from "../../../src/docs/doc-index.ts";
import { governedRecord } from "../../../src/docs/doc-rules.ts";

const FIXTURE = readFileSync(resolve(import.meta.dir, "..", "..", "fixtures", "docs", "adr.md"), "utf8");

const PART = governedRecord({ path: "docs/adr/0001-a-part-names-its-supplier.md", text: FIXTURE });
const SPARE = governedRecord({
  path: "docs/adr/0002-a-spare-names-its-supplier.md",
  text: FIXTURE.replace("governs: [widget.ts]", "governs: [src/spares.ts, docs]").replace("# 1. A part", "# 2. A spare").replace("Accepted.", "Rejected."),
});

const INDEX = [
  "<!-- generated adr-index: checks-adr-index writes it from the records in docs/adr/ -->",
  "",
  "| Number | Title | Status | Governs |",
  "| --- | --- | --- | --- |",
  "| [0001](0001-a-part-names-its-supplier.md) | A part names its supplier | Accepted | `widget.ts` |",
  "| [0002](0002-a-spare-names-its-supplier.md) | A spare names its supplier | Rejected | `src/spares.ts`, `docs` |",
  "",
  "<!-- end generated adr-index -->",
].join("\n");

test("a missing README is written as a titled index whose rows run in file order, not in the order the records were read", () => {
  expect(writtenIndex(undefined, [SPARE, PART])).toBe(`# Decision records\n\n${INDEX}\n`);
});

test("rewriting the index keeps the prose around the block rather than replacing the whole README", () => {
  const prose = "# Records\n\nEach record governs paths.\n";
  const appended = writtenIndex(prose, [PART, SPARE]);
  expect(appended).toBe(`${prose}\n${INDEX}\n`);
  const stale = appended.replace("| Rejected |", "| Accepted |").concat("A closing line.\n");
  expect(writtenIndex(stale, [PART, SPARE])).toBe(`${prose}\n${INDEX}\nA closing line.\n`);
});

test("an index that misses a status change reads as stale at that row, not fresh", () => {
  const readme = `# Records\n\n${INDEX}\n`;
  expect(indexState(readme, [PART, SPARE])).toEqual({ type: "fresh" });
  expect(indexState(readme.replace("| Rejected |", "| Accepted |"), [PART, SPARE])).toEqual({ type: "stale", line: 8 });
  expect(indexState(readme, [PART])).toEqual({ type: "stale", line: 8 });
  expect(indexState("# Records\n", [PART])).toEqual({ type: "unmarked" });
  expect(indexState(undefined, [PART])).toEqual({ type: "missing" });
});
