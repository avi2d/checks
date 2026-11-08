import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { deletedGoverned, existsIn, missingGoverned } from "../../../src/docs/doc-governs.ts";
import { snapshotOf } from "../../../src/docs/doc-references.ts";
import { governedRecord, judge, recordsOf, type Doc } from "../../../src/docs/doc-rules.ts";

const FIRST = "docs/adr/0001-a-part-names-its-supplier.md";
const SECOND = "docs/adr/0002-a-spare-names-its-supplier.md";
const FIXTURE = readFileSync(resolve(import.meta.dir, "..", "..", "fixtures", "docs", "adr.md"), "utf8");

function record(frontMatter: string, status = "Accepted."): string {
  const body = FIXTURE.slice(FIXTURE.indexOf("# 1.")).replace("Accepted.", status);
  return frontMatter === "" ? body : `---\n${frontMatter}\n---\n${body}`;
}

function refused(text: string, others: readonly Doc[] = []): readonly string[] {
  const doc = { path: FIRST, text };
  return judge("adr", doc, recordsOf([doc, ...others])).map(({ line, message }) => `${line}: ${message}`);
}

function tree(...files: readonly string[]) {
  return snapshotOf(files, new Map(), new Map());
}

test("a record with no front matter or no governs key is refused rather than read as governing nothing", () => {
  const missing = "1: has no `governs` in its front matter. List the paths the record governs, as in `governs: [src/parts.ts]`";
  expect(refused(record(""))).toEqual([missing]);
  expect(refused(record("topics: [parts]"))).toEqual([missing]);
});

test("a governs that is not a list of path strings is refused rather than taken as a path", () => {
  const malformed = "3: holds a `governs` that is not a list of paths, as in `governs: [src/parts.ts]`";
  expect(refused(record("topics: [parts]\ngoverns: src/parts.ts"))).toEqual([malformed]);
  expect(refused(record("topics: [parts]\ngoverns: [1]"))).toEqual([malformed]);
  expect(refused(record("topics: [parts]\ngoverns: ['']"))).toEqual([malformed]);
});

test("an empty governs is refused on a Proposed or Accepted record, and passes on a Rejected, Deprecated, Superseded or Retired one", () => {
  const empty = "2: lists no path in `governs`, which a live record keeps. List the paths it governs, or retire it with Superseded or Retired in `## Status`";
  for (const status of ["Accepted.", "Proposed.", "Accepted. Superseded in part by 0002."]) {
    expect(refused(record("governs: []", status))).toEqual([empty]);
  }
  for (const status of ["Rejected. No supplier ever existed.", "Deprecated. The parts list is going away.", "Retired. The parts list is gone."]) {
    expect(refused(record("governs: []", status))).toEqual([]);
  }
  expect(refused(record("governs: []", "Superseded by 0002."), [{ path: SECOND, text: record("governs: [a.ts]", "Accepted. Supersedes 0001.").replace("# 1.", "# 2.") }])).toEqual([]);
});

test("a governs listed as a YAML block is read as its paths, not refused as malformed", () => {
  const text = record("governs:\n  - src/parts.ts\n  - docs/parts.md");
  expect(refused(text)).toEqual([]);
  expect(missingGoverned(governedRecord({ path: FIRST, text }), tree("src/parts.ts"))).toEqual([
    {
      path: FIRST,
      line: 4,
      governed: "docs/parts.md",
      message: "governs `docs/parts.md`, which is not in the repository. Name a tracked file or directory, or retire it with Superseded or Retired in `## Status`",
    },
  ]);
});

test("only the exact repository-root-relative path exists, and no other spelling of it does", () => {
  const head = tree("src/parts/list.ts", "README.md");
  expect(["src/parts", "src", "README.md", "src/parts/list.ts"].map((path) => existsIn(head, path))).toEqual(
    Array.from({ length: 4 }, () => true),
  );
  expect(["src/parts/", "./src/parts", "src//parts", " src/parts", "/src/parts/list.ts", "src/part", "src/parts/list", "../src/parts", "~/.no-mistakes/config.yaml", "/src/parts/gone.ts"].map((path) => existsIn(head, path))).toEqual(
    Array.from({ length: 10 }, () => false),
  );
});

test("a missing path that is a prefix of another entry is reported on its own entry, not the longer one", () => {
  const text = record("governs:\n  - src/docs/a.ts\n  - docs");
  expect(missingGoverned(governedRecord({ path: FIRST, text }), tree("src/docs/a.ts"))).toEqual([
    {
      path: FIRST,
      line: 4,
      governed: "docs",
      message: "governs `docs`, which is not in the repository. Name a tracked file or directory, or retire it with Superseded or Retired in `## Status`",
    },
  ]);
});

test("a retired record keeps its governs paths unchecked, so its gone paths do not fail it", () => {
  const retired = governedRecord({ path: FIRST, text: record("governs: [src/parts.ts]", "Retired. The parts list is gone.") });
  const superseded = governedRecord({ path: FIRST, text: record("governs: [src/parts.ts]", "Superseded by 0002.") });
  expect([...missingGoverned(retired, tree()), ...missingGoverned(superseded, tree())]).toEqual([]);
});

const LIVE = record("governs: [src/parts.ts, docs]");

function deletion(before: string, after: string | undefined, base: readonly string[], head: readonly string[], afterPath = FIRST) {
  return deletedGoverned(
    [governedRecord({ path: FIRST, text: before })],
    after === undefined ? [] : [governedRecord({ path: afterPath, text: after })],
    tree(...base),
    tree(...head),
  ).map(({ path, line, message }) => `${path}:${line ?? ""}: ${message}`);
}

test("deleting a governed path while the record stays live is refused, and retiring it in the same range passes", () => {
  const base = ["src/parts.ts", "docs/parts.md"];
  expect(deletion(LIVE, LIVE, base, ["docs/parts.md"])).toEqual([
    `${FIRST}:2: governs \`src/parts.ts\`, which the range deletes. In the same change, retire it with Superseded or Retired in \`## Status\``,
  ]);
  expect(deletion(LIVE, record("governs: [docs]"), base, ["docs/parts.md"])).toEqual([
    `${FIRST}:2: governs \`src/parts.ts\`, which the range deletes. In the same change, retire it with Superseded or Retired in \`## Status\``,
  ]);
  expect(deletion(LIVE, record("governs: [src/parts.ts, docs]", "Retired. Parts left."), base, ["docs/parts.md"])).toEqual([]);
  expect(deletion(LIVE, record("governs: [src/parts.ts, docs]", "Superseded by 0002."), base, [])).toEqual([]);
});

test("deleting a record with the path it governs is refused rather than taken as retiring it", () => {
  expect(deletion(LIVE, undefined, ["src/parts.ts", "docs/parts.md"], ["docs/parts.md"])).toEqual([
    `${FIRST}:: is deleted with \`src/parts.ts\`, which it governs. Keep the record and retire it with Superseded or Retired in \`## Status\``,
  ]);
});

test("a renamed record is matched by its number, so the refusal names the record where it now sits", () => {
  const moved = "docs/adr/0001-parts-name-suppliers.md";
  expect(deletion(LIVE, LIVE, ["src/parts.ts", "docs/parts.md"], ["docs/parts.md"], moved)).toEqual([
    `${moved}:2: governs \`src/parts.ts\`, which the range deletes. In the same change, retire it with Superseded or Retired in \`## Status\``,
  ]);
});

test("only a deletion of a live record's path is refused, not a file left under a governed directory or a path already gone", () => {
  expect(deletion(LIVE, LIVE, ["src/parts.ts", "docs/a.md", "docs/b.md"], ["src/parts.ts", "docs/b.md"])).toEqual([]);
  expect(deletion(LIVE, LIVE, ["docs/parts.md"], ["docs/parts.md"])).toEqual([]);
  const retired = record("governs: [src/parts.ts]", "Retired. Parts left.");
  expect(deletion(retired, retired, ["src/parts.ts"], [])).toEqual([]);
});

const OTHERS: readonly Doc[] = [{ path: SECOND, text: record("governs: [a.ts]").replace("# 1.", "# 2.") }];

function withDecision(decision: string, frontMatter = "governs: [a.ts]"): string {
  return record(frontMatter).replace("A part names its supplier.\n\n## What", `A part names its supplier.\n${decision}\n\n## What`);
}

test("a supersession of a known record stated outside Status is refused at its line, not passed", () => {
  expect(refused(withDecision("This record supersedes record 0002. Parts keep their names."), OTHERS)).toEqual([
    "19: states a supersession of 0002 outside `## Status`, which is its one home. Move it into `## Status`",
  ]);
  expect(refused(withDecision("Record 0002 superseded the first parts list."), OTHERS)).toHaveLength(1);
});

test("a quote, a code span, an unknown number, a year and the record's own number are not read as a supersession", () => {
  for (const decision of [
    "> Write a record that supersedes 0002",
    "The `supersedes 0002` clause is an example.",
    "This record supersedes record 0042.",
    "In 2026 the parts list was superseded.",
    "Record 0001 supersedes the old parts list.",
    "Record 0002 names a spare. The old list was superseded.",
  ]) {
    expect(refused(withDecision(decision), OTHERS)).toEqual([]);
  }
});

test("a supersession key in front matter is refused, since the fact lives in Status alone", () => {
  expect(refused(record("governs: [a.ts]\nsuperseded_by: 2"), OTHERS)).toEqual([
    "3: holds `superseded_by` in its front matter, and a supersession lives in `## Status` alone. Move it there",
  ]);
  expect(refused(record("governs: [a.ts]\n'supersedes': [2]"), OTHERS)).toEqual([
    "3: holds `supersedes` in its front matter, and a supersession lives in `## Status` alone. Move it there",
  ]);
});
