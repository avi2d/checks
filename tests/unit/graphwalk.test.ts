import { expect, test } from "bun:test";
import { Effect } from "effect";
import { baselineOf, driftOf, exportsReport, filesOf, symbolsOf, unusedReport, type Baseline } from "../../src/complexity/graphwalk.ts";

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

test("filesOf names each unreferenced .ts, .tsx or .astro file in Knip JSON report, sorted, and nothing else", () => {
  expect(Effect.runSync(filesOf(KNIP))).toEqual(["src/planted-dead.ts"]);
  expect(Effect.runSync(filesOf("{\"issues\":[]}\n"))).toEqual([]);
});

test("filesOf fails on output that is not Knip JSON report", () => {
  expect(Effect.runSync(Effect.flip(filesOf("Unused files (1)\nsrc/dead.ts\n"))).message).toContain("knip's JSON report does not decode");
  expect(Effect.runSync(Effect.flip(filesOf("{\"files\":[\"src/dead.ts\"]}"))).message).toContain("knip's JSON report does not decode");
});
test("symbolsOf names each unused export and type in Knip JSON report, sorted, and nothing else", () => {
  expect(Effect.runSync(symbolsOf(KNIP))).toEqual([
    { file: "src/other.ts", kind: "export", name: "otherExport" },
    { file: "src/used.ts", kind: "export", name: "unusedExport" },
    { file: "src/used.ts", kind: "type", name: "UnusedOptions" },
  ]);
  expect(Effect.runSync(symbolsOf("{\"issues\":[]}\n"))).toEqual([]);
});

test("symbolsOf fails on output that is not Knip JSON report", () => {
  expect(Effect.runSync(Effect.flip(symbolsOf("Unused exports (1)\nsrc/used.ts"))).message).toContain("knip's JSON report does not decode");
  expect(Effect.runSync(Effect.flip(symbolsOf("{\"files\":[\"src/used.ts\"]}"))).message).toContain("knip's JSON report does not decode");
});

test("baselineOf decodes the committed baseline and fails on what is not one", () => {
  const baseline: Baseline = [{ file: "src/used.ts", kind: "export", name: "unusedExport" }];
  expect(Effect.runSync(baselineOf(JSON.stringify(baseline), "exports-baseline.json"))).toEqual(baseline);
  expect(Effect.runSync(baselineOf("[]", "exports-baseline.json"))).toEqual([]);
  expect(Effect.runSync(Effect.flip(baselineOf("{\"src/used.ts\":[\"unusedExport\"]}", "exports-baseline.json"))).message).toContain(
    "exports-baseline.json does not decode",
  );
});

test("driftOf refuses an unlisted symbol, an added entry its base left used, and a stale entry", () => {
  const reported: Baseline = [
    { file: "src/used.ts", kind: "export", name: "unusedExport" },
    { file: "src/used.ts", kind: "type", name: "UnusedOptions" },
    { file: "src/new.ts", kind: "export", name: "listed" },
    { file: "src/old.ts", kind: "export", name: "seeded" },
  ];
  const base: Baseline = [
    { file: "src/used.ts", kind: "export", name: "unusedExport" },
    { file: "src/used.ts", kind: "type", name: "UnusedOptions" },
    { file: "src/gone.ts", kind: "export", name: "removed" },
  ];
  const head: Baseline = [
    { file: "src/used.ts", kind: "export", name: "unusedExport" },
    { file: "src/new.ts", kind: "export", name: "listed" },
    { file: "src/old.ts", kind: "export", name: "seeded" },
    { file: "src/gone.ts", kind: "export", name: "removed" },
  ];
  const unusedAtBase: Baseline = [{ file: "src/old.ts", kind: "export", name: "seeded" }];
  expect(driftOf({ reported, base, head, unusedAtBase })).toEqual({
    unlisted: [{ file: "src/used.ts", kind: "type", name: "UnusedOptions" }],
    added: [{ file: "src/new.ts", kind: "export", name: "listed" }],
    stale: [{ file: "src/gone.ts", kind: "export", name: "removed" }],
  });
  expect(driftOf({ reported, base: [], head: reported, unusedAtBase: reported })).toEqual({ unlisted: [], added: [], stale: [] });
  expect(driftOf({ reported: [], base, head: [], unusedAtBase: [] })).toEqual({ unlisted: [], added: [], stale: [] });
});

test("exportsReport holds a clean scan, counts a held baseline, and lists each drift", () => {
  const none = { unlisted: [], added: [], stale: [] };
  expect(exportsReport([], none)).toBe("exports: no unused exports or types");
  expect(exportsReport([{ file: "src/used.ts", kind: "export", name: "unusedExport" }], none)).toBe(
    "exports: 1 unused export(s) in exports-baseline.json, and no new ones",
  );
  expect(
    exportsReport([], {
      unlisted: [{ file: "src/used.ts", kind: "export", name: "unusedExport" }],
      added: [{ file: "src/new.ts", kind: "export", name: "listed" }],
      stale: [{ file: "src/gone.ts", kind: "type", name: "Removed" }],
    }),
  ).toBe(
    [
      "exports: 1 unused export(s) not in exports-baseline.json:",
      "  src/used.ts: unusedExport (export)",
      "exports: 1 exports-baseline.json export(s) the range adds that its base did not leave unused, remove the export instead:",
      "  src/new.ts: listed (export)",
      "exports: 1 exports-baseline.json export(s) no longer reported, remove them:",
      "  src/gone.ts: Removed (type)",
    ].join("\n"),
  );
});

test("unusedReport counts a clean scan and lists each dead file", () => {
  expect(unusedReport({ tracked: 110, files: [] })).toBe("unused: no unreferenced files among 110 tracked .ts/.tsx/.astro file(s)");
  expect(unusedReport({ tracked: 3, files: ["src/dead.ts", "src/other.ts"] })).toBe("unused: 2 unreferenced file(s):\n  src/dead.ts\n  src/other.ts");
});