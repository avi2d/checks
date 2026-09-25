import { expect, test } from "bun:test";
import { clonesOf, describe, heldOf, report, repeatedLines, risesOf, type Clone, type Fragment } from "../scripts/repetition.ts";

function fragment(file: string, start: number, end: number): Fragment {
  return { file, start, end };
}

const LEDGER_FRESH: Clone = [fragment("src/ledger.ts", 4, 13), fragment("src/fresh.ts", 1, 10)];
const FIXTURE_COPY: Clone = [fragment("tests/one.test.ts", 1, 10), fragment("tests/two.test.ts", 1, 10)];

test("repeatedLines counts each line a clone's fragments cover once, across every clone a file appears in", () => {
  const lines = repeatedLines([LEDGER_FRESH, FIXTURE_COPY]);
  expect(lines.get("src/ledger.ts")).toBe(10);
  expect(lines.get("src/fresh.ts")).toBe(10);
  expect(lines.get("tests/one.test.ts")).toBe(10);
  expect(lines.has("src/other.ts")).toBe(false);
});

test("a file's repeated lines are the union of its fragments, so overlapping clones count a line once", () => {
  const counted = repeatedLines([
    [fragment("src/a.ts", 1, 10), fragment("src/b.ts", 21, 30)],
    [fragment("src/a.ts", 6, 15), fragment("src/c.ts", 1, 10)],
    [fragment("src/c.ts", 20, 24), fragment("src/c.ts", 30, 34)],
  ]);
  expect(Object.fromEntries(counted)).toEqual({ "src/a.ts": 15, "src/b.ts": 10, "src/c.ts": 20 });
});

test("clonesOf finds a file on either side of a clone, its own fragment first, sorted by where it starts", () => {
  expect(clonesOf("src/fresh.ts", [LEDGER_FRESH])).toEqual([[fragment("src/fresh.ts", 1, 10), fragment("src/ledger.ts", 4, 13)]]);
  expect(clonesOf("src/ledger.ts", [LEDGER_FRESH])).toEqual([[fragment("src/ledger.ts", 4, 13), fragment("src/fresh.ts", 1, 10)]]);
  expect(clonesOf("src/other.ts", [LEDGER_FRESH])).toEqual([]);
});

test("risesOf holds a file to what it repeated at the base, following a rename to its former path", () => {
  const before = new Map([["src/ledger.ts", 10]]);
  const after = new Map([["src/ledger.ts", 10], ["src/lib/ledger.ts", 20], ["src/small.ts", 0]]);
  const formerPath = new Map([["src/lib/ledger.ts", "src/ledger.ts"]]);
  const rises = risesOf(["src/ledger.ts", "src/lib/ledger.ts", "src/small.ts"], before, after, formerPath, []);
  expect(rises).toEqual([{ file: "src/lib/ledger.ts", before: 10, after: 20, clones: [] }]);
});

test("risesOf sorts by file, and a file the base never repeated rises from zero", () => {
  const after = new Map([["src/b.ts", 10], ["src/a.ts", 10]]);
  const rises = risesOf(["src/b.ts", "src/a.ts"], new Map(), after, new Map(), []);
  expect(rises.map((rise) => rise.file)).toEqual(["src/a.ts", "src/b.ts"]);
  expect(rises[0]).toEqual({ file: "src/a.ts", before: 0, after: 10, clones: [] });
});

test("heldOf tallies a held file that did not rise, and every file outside the held set, as advisory", () => {
  const rise = { file: "src/fresh.ts", before: 0, after: 10, clones: [] };
  const after = new Map([["src/fresh.ts", 10], ["src/kept.ts", 5]]);
  const held = heldOf(2, [rise], after, new Map([["tests/one.test.ts", 10]]));
  expect(held).toEqual({
    measured: 2,
    rises: [rise],
    advisory: new Map([["src/kept.ts", 5], ["tests/one.test.ts", 10]]),
  });
});

test("report renders a rise with its clones, and the advisory notice beneath it", () => {
  const rise = { file: "src/fresh.ts", before: 0, after: 10, clones: [[fragment("src/fresh.ts", 1, 10), fragment("src/ledger.ts", 4, 13)]] as const };
  const held = { measured: 3, rises: [rise], advisory: new Map([["tests/one.test.ts", 10]]) };
  expect(report(held)).toBe(
    [
      "repetition: 1 production file(s) repeat more lines than where the range starts, at 50 tokens and 5 lines:",
      "  src/fresh.ts: 10 repeated line(s), up from 0",
      "    src/fresh.ts:1-10 repeats src/ledger.ts:4-13",
      "repetition: advisory, 1 file(s) repeat lines the hold does not fail:",
      "  tests/one.test.ts: 10 repeated line(s)",
    ].join("\n"),
  );
});

test("report renders success by count, with no advisory line when nothing repeats outside the hold", () => {
  expect(report({ measured: 3, rises: [], advisory: new Map() })).toBe(
    "repetition: 3 production file(s) repeat no more lines than where the range starts, at 50 tokens and 5 lines",
  );
});

test("describe lists a rise's own line and every clone it names, own fragment first", () => {
  const rise = { file: "src/fresh.ts", before: 0, after: 10, clones: [[fragment("src/fresh.ts", 1, 10), fragment("src/ledger.ts", 4, 13)]] as const };
  expect(describe(rise)).toEqual([
    "  src/fresh.ts: 10 repeated line(s), up from 0",
    "    src/fresh.ts:1-10 repeats src/ledger.ts:4-13",
  ]);
});
