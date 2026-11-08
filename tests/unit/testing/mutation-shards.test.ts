import { expect, test } from "bun:test";
import { balancedShards, mutantWeights, runnableMutants } from "../../../src/testing/mutation-shards.ts";

const weights = (entries: Record<string, number>): ReadonlyMap<string, number> => new Map(Object.entries(entries));

test("files split into two shards of 17 mutants each, heaviest first, rather than dealt round-robin into 20 and 14", () => {
  const shards = balancedShards(weights({ "src/a.ts": 10, "src/b.ts": 9, "src/c.ts": 7, "src/d.ts": 4, "src/e.ts": 3, "src/f.ts": 1 }), 2);

  expect(shards).toEqual([
    { files: ["src/a.ts", "src/d.ts", "src/e.ts"], mutants: 17 },
    { files: ["src/b.ts", "src/c.ts", "src/f.ts"], mutants: 17 },
  ]);
});

test("equal weights take files in path order and a tie for lightest goes to the lowest shard, not the last", () => {
  expect(balancedShards(weights({ "src/z.ts": 5, "src/y.ts": 5, "src/x.ts": 5 }), 2)).toEqual([
    { files: ["src/x.ts", "src/z.ts"], mutants: 10 },
    { files: ["src/y.ts"], mutants: 5 },
  ]);
});

test("more shards than files leaves out the empty shards rather than printing a shard that mutates nothing", () => {
  expect(balancedShards(weights({ "src/a.ts": 3, "src/b.ts": 2, "src/c.ts": 1 }), 5)).toEqual([
    { files: ["src/a.ts"], mutants: 3 },
    { files: ["src/b.ts"], mutants: 2 },
    { files: ["src/c.ts"], mutants: 1 },
  ]);
  expect(balancedShards(new Map(), 3)).toEqual([]);
});

test("a file the report lacks weighs the reported average rounded up, and a reported file no longer mutated weighs nothing", () => {
  const reported = weights({ "src/a.ts": 10, "src/b.ts": 5, "src/gone.ts": 100 });

  expect(mutantWeights(["src/a.ts", "src/b.ts", "src/new.ts"], reported)).toEqual(weights({ "src/a.ts": 10, "src/b.ts": 5, "src/new.ts": 8 }));
});

test("static, Ignored and NoCoverage mutants carry no weight rather than counting every mutant the report lists", () => {
  expect(runnableMutants([{ status: "Killed" }, { status: "Survived", static: true }, { status: "Ignored" }, { status: "NoCoverage" }, {}])).toBe(2);
});

test("with no report each file weighs one mutant, so the shards balance by file count rather than all landing in one", () => {
  const even = mutantWeights(["src/a.ts", "src/b.ts", "src/c.ts", "src/d.ts"], new Map());

  expect(balancedShards(even, 2).map(({ files }) => files.length)).toEqual([2, 2]);
});
