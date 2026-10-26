import { expect, test } from "bun:test";
import { Effect } from "effect";
import { filesOf, report } from "../../src/complexity/unused.ts";

const KNIP = JSON.stringify({
  issues: [
    { file: "src/planted-dead2.ts", files: [{ name: "src/planted-dead2.ts" }], exports: [] },
    { file: "src/used.ts", files: [], exports: [{ name: "unusedExport", line: 2, col: 14 }] },
    { file: "scripts/dead.mjs", files: [{ name: "scripts/dead.mjs" }] },
    { file: "src/planted-dead.tsx", files: [{ name: "src/planted-dead.tsx" }] },
    { file: "src/planted-dead.astro", files: [{ name: "src/planted-dead.astro" }] },
    { file: "package.json", dependencies: [{ name: "zod" }] },
  ],
});

test("filesOf names each unreferenced .ts, .tsx or .astro file in Knip's JSON report, sorted, and nothing else", () => {
  expect(Effect.runSync(filesOf(KNIP))).toEqual(["src/planted-dead.astro", "src/planted-dead.tsx", "src/planted-dead2.ts"]);
  expect(Effect.runSync(filesOf(`{"issues":[]}\n`))).toEqual([]);
});

test("filesOf fails on output that is not Knip's JSON report", () => {
  expect(Effect.runSync(Effect.flip(filesOf("Unused files (1)\nsrc/dead.ts\n"))).message).toContain("knip's JSON report does not decode");
  expect(Effect.runSync(Effect.flip(filesOf(`{"files":["src/dead.ts"]}`))).message).toContain("knip's JSON report does not decode");
});

test("report counts a clean scan and lists each dead file", () => {
  expect(report({ tracked: 110, files: [] })).toBe("unused: no unreferenced files among 110 tracked .ts/.tsx/.astro file(s)");
  expect(report({ tracked: 3, files: ["src/dead.ts", "src/other.ts"] })).toBe("unused: 2 unreferenced file(s):\n  src/dead.ts\n  src/other.ts");
});
