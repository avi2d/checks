import { expect, test } from "bun:test";
import { Effect } from "effect";
import { mergeShards, parseArgs, type Report } from "../../../src/testing/mutation-merge.ts";

const ONE = { name: "t1 > one", location: { start: { line: 1, column: 1 } } };
const TWO = { name: "t1 > two", location: { start: { line: 5, column: 1 } } };
const THREE = { name: "t2 > three", location: { start: { line: 1, column: 1 } } };
const AT = { location: { start: { line: 1, column: 1 }, end: { line: 1, column: 9 } }, mutatorName: "BooleanLiteral", replacement: "false" };

const shardA: Report = {
  schemaVersion: "1.0",
  thresholds: { high: 85, low: 70, break: null },
  projectRoot: "/runner/work/repo",
  files: { "src/a.ts": { language: "typescript", source: "a", mutants: [{ ...AT, id: "0", status: "Killed", coveredBy: ["0", "1"], killedBy: ["1"] }] } },
  testFiles: { "tests/unit/t1.test.ts": { source: "t1", tests: [{ ...ONE, id: "0" }, { ...TWO, id: "1" }] } },
};

const shardB: Report = {
  schemaVersion: "1.0",
  thresholds: { high: 85, low: 70, break: null },
  projectRoot: "/runner/work/repo",
  files: {
    "src/b.ts": {
      language: "typescript",
      source: "b",
      mutants: [
        { ...AT, id: "0", status: "Killed", coveredBy: ["1", "2"], killedBy: ["2"] },
        { ...AT, id: "1", status: "NoCoverage", coveredBy: [] },
      ],
    },
  },
  testFiles: {
    "tests/unit/t1.test.ts": { source: "t1", tests: [{ ...TWO, id: "0" }, { ...ONE, id: "1" }] },
    "tests/unit/t2.test.ts": { source: "t2", tests: [{ ...THREE, id: "2" }] },
  },
};

const merged = (first: Report, ...rest: readonly Report[]) =>
  mergeShards([{ path: "shard-1.json", report: first }, ...rest.map((report, index) => ({ path: `shard-${index + 2}.json`, report }))]);

test("two shards merge into one report whose tests each keep one id, renumbered rather than kept from each shard's own numbering", () => {
  expect(merged(shardA, shardB)).toEqual({
    merged: {
      schemaVersion: "1.0",
      thresholds: { high: 85, low: 70, break: null },
      projectRoot: "/runner/work/repo",
      files: {
        "src/a.ts": { language: "typescript", source: "a", mutants: [{ ...AT, id: "0", status: "Killed", coveredBy: ["0", "1"], killedBy: ["1"] }] },
        "src/b.ts": {
          language: "typescript",
          source: "b",
          mutants: [
            { ...AT, id: "1", status: "Killed", coveredBy: ["0", "2"], killedBy: ["2"] },
            { ...AT, id: "2", status: "NoCoverage", coveredBy: [] },
          ],
        },
      },
      testFiles: {
        "tests/unit/t1.test.ts": { source: "t1", tests: [{ ...ONE, id: "0" }, { ...TWO, id: "1" }] },
        "tests/unit/t2.test.ts": { source: "t2", tests: [{ ...THREE, id: "2" }] },
      },
    },
  });
});

test("one shard merges into the report it already is, so a single-job matrix needs no other path", () => {
  expect(merged(shardA)).toEqual({ merged: shardA });
});

test("a file in two shards is a conflict rather than one shard's mutants silently replacing the other's", () => {
  expect(merged(shardA, { ...shardB, files: shardA.files })).toEqual({ conflict: "src/a.ts is in both shard-1.json and shard-2.json, so the shards did not split the mutated files" });
});

test("a test file whose source differs between shards is a conflict, since the shards then tested different commits", () => {
  const edited = { ...shardB, testFiles: { "tests/unit/t1.test.ts": { source: "t1 edited", tests: [] } } };

  expect(merged(shardA, edited)).toEqual({ conflict: "shard-2.json ran another source of tests/unit/t1.test.ts than the shard before it, so the shards did not run one commit" });
});

test("a mutant naming a test its report does not hold is a conflict rather than a mutant covered by nothing", () => {
  const dangling = { ...shardB, testFiles: {} };

  expect(merged(shardA, dangling)).toEqual({ conflict: "mutant 0 in src/b.ts of shard-2.json names a test the report's testFiles do not hold" });
});

test("shards of two schema versions are a conflict rather than one report mixing both", () => {
  expect(merged(shardA, { ...shardB, schemaVersion: "2" })).toEqual({ conflict: "shard-2.json has schema version 2, and shard-1.json has 1.0" });
});

test("the arguments are an output and at least one shard report, and no flag", async () => {
  const parsed = (argv: readonly string[]) => Effect.runPromise(parseArgs(argv).pipe(Effect.match({ onFailure: () => "usage", onSuccess: (options) => options })));

  expect(await parsed(["out.json", "a.json", "b.json"])).toEqual({ output: "out.json", inputs: ["a.json", "b.json"] });
  expect(await Promise.all([[], ["out.json"], ["out.json", "--force", "a.json"]].map(parsed))).toEqual(["usage", "usage", "usage"]);
});
