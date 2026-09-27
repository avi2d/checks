import { expect, test } from "bun:test";
import { Effect } from "effect";
import { baselineOf, driftOf, report, symbolsOf, type Baseline } from "../../src/complexity/exports.ts";

const KNIP = JSON.stringify({
  issues: [
    {
      file: "src/used.ts",
      files: [],
      exports: [{ name: "unusedExport", line: 2, col: 14 }],
      types: [{ name: "UnusedOptions", line: 5, col: 13 }],
    },
    { file: "src/planted-dead.ts", files: [{ name: "src/planted-dead.ts" }], exports: [], types: [] },
    { file: "package.json", dependencies: [{ name: "zod" }] },
    { file: "src/other.ts", exports: [{ name: "otherExport", line: 1, col: 14 }] },
  ],
});

test("symbolsOf names each unused export and type in Knip's JSON report, sorted, and nothing else", () => {
  expect(Effect.runSync(symbolsOf(KNIP))).toEqual([
    { file: "src/other.ts", kind: "export", name: "otherExport" },
    { file: "src/used.ts", kind: "export", name: "unusedExport" },
    { file: "src/used.ts", kind: "type", name: "UnusedOptions" },
  ]);
  expect(Effect.runSync(symbolsOf(`{"issues":[]}\n`))).toEqual([]);
});

test("symbolsOf fails on output that is not Knip's JSON report", () => {
  expect(Effect.runSync(Effect.flip(symbolsOf("Unused exports (1)\nsrc/used.ts"))).message).toContain("knip's JSON report does not decode");
  expect(Effect.runSync(Effect.flip(symbolsOf(`{"files":["src/used.ts"]}`))).message).toContain("knip's JSON report does not decode");
});

test("baselineOf decodes the committed baseline and fails on what is not one", () => {
  const baseline: Baseline = [{ file: "src/used.ts", kind: "export", name: "unusedExport" }];
  expect(Effect.runSync(baselineOf(JSON.stringify(baseline), "exports-baseline.json"))).toEqual(baseline);
  expect(Effect.runSync(baselineOf("[]", "exports-baseline.json"))).toEqual([]);
  expect(Effect.runSync(Effect.flip(baselineOf(`{"src/used.ts":["unusedExport"]}`, "exports-baseline.json"))).message).toContain(
    "exports-baseline.json does not decode",
  );
});

test("driftOf refuses an unused export the baseline does not hold and a baseline entry Knip no longer reports", () => {
  const reported: Baseline = [
    { file: "src/used.ts", kind: "export", name: "unusedExport" },
    { file: "src/used.ts", kind: "type", name: "UnusedOptions" },
  ];
  const baseline: Baseline = [
    { file: "src/used.ts", kind: "export", name: "unusedExport" },
    { file: "src/gone.ts", kind: "export", name: "removed" },
  ];
  expect(driftOf(reported, baseline)).toEqual({
    unlisted: [{ file: "src/used.ts", kind: "type", name: "UnusedOptions" }],
    stale: [{ file: "src/gone.ts", kind: "export", name: "removed" }],
  });
  expect(driftOf(reported, reported)).toEqual({ unlisted: [], stale: [] });
});

test("report holds a clean scan, counts a held baseline, and lists each drift", () => {
  expect(report([], { unlisted: [], stale: [] })).toBe("exports: no unused exports or types");
  expect(report([{ file: "src/used.ts", kind: "export", name: "unusedExport" }], { unlisted: [], stale: [] })).toBe(
    "exports: 1 unused export(s) in exports-baseline.json, and no new ones",
  );
  expect(
    report([], {
      unlisted: [{ file: "src/used.ts", kind: "export", name: "unusedExport" }],
      stale: [{ file: "src/gone.ts", kind: "type", name: "Removed" }],
    }),
  ).toBe(
    "exports: 1 unused export(s) not in exports-baseline.json:\n  src/used.ts: unusedExport (export)\nexports: 1 exports-baseline.json export(s) no longer reported, remove them:\n  src/gone.ts: Removed (type)",
  );
});
