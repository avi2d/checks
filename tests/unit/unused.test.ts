import { expect, test } from "bun:test";
import { filesOf, report, unmatchedOf } from "../../src/complexity/unused.ts";

const PLANTED = "Unused files (2)\nsrc/planted-dead.ts \nsrc/planted-dead2.ts\n";
const HINTS =
  "Configuration hints (3)\nsrc/complexity/unused.ts                  knip.json  Refine entry pattern (no matches)\nsrc/core/lint.ts                          knip.json  Remove redundant entry pattern   \n...1 more similar hints                                                               \n";

test("filesOf names each file under the unused-files header, trimmed, and nothing else", () => {
  expect(filesOf(PLANTED)).toEqual(["src/planted-dead.ts", "src/planted-dead2.ts"]);
  expect(filesOf("")).toEqual([]);
  expect(filesOf(HINTS)).toEqual([]);
});

test("filesOf stops at a blank line or at the next section the report can hold", () => {
  expect(filesOf("Unused files (1)\nsrc/dead.ts\n\nUnused exports (1)\nsrc/other.ts\n")).toEqual(["src/dead.ts"]);
  expect(filesOf("Unused files (1)\nsrc/dead.ts\nConfiguration hints (1)\n")).toEqual(["src/dead.ts"]);
});

test("unmatchedOf names only the entry patterns Knip cannot match", () => {
  expect(unmatchedOf(HINTS)).toEqual(["src/complexity/unused.ts"]);
  expect(unmatchedOf("")).toEqual([]);
  expect(unmatchedOf(PLANTED)).toEqual([]);
});

test("unmatchedOf keeps a bracketed glob whole", () => {
  expect(unmatchedOf("[src/missing/**/*.ts]    knip.json  Refine entry pattern (no matches)")).toEqual(["[src/missing/**/*.ts]"]);
});

test("report counts a clean scan, and lists dead files before mistyped entries", () => {
  expect(report({ tracked: 110, files: [], unmatched: [] })).toBe("unused: no unreferenced files among 110 tracked .ts/.tsx file(s)");
  expect(report({ tracked: 3, files: ["src/dead.ts"], unmatched: [] })).toBe("unused: 1 unreferenced file(s):\n  src/dead.ts");
  expect(report({ tracked: 3, files: [], unmatched: ["src/missing.ts"] })).toBe(
    "unused: 1 knip entry pattern(s) match no file:\n  src/missing.ts",
  );
  expect(report({ tracked: 3, files: ["src/dead.ts"], unmatched: ["src/missing.ts"] })).toBe(
    "unused: 1 unreferenced file(s):\n  src/dead.ts\nunused: 1 knip entry pattern(s) match no file:\n  src/missing.ts",
  );
});
