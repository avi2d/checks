import { expect, test } from "bun:test";
import { parseShard } from "../../../src/core/shard.ts";
import { shardFiles } from "../../../src/testing/test-shard.ts";

const byText = (a: string, b: string) => a.localeCompare(b);

test("shards do not duplicate or omit files without timings", () => {
  const files = ["a", "b", "c", "d", "e"];
  const shards = [1, 2].map((index) => shardFiles(files, {}, { index, count: 2 }));
  expect(shards.flat().sort(byText)).toEqual(files);
  expect(shards.map((shard) => shard.length).sort((a, b) => a - b)).toEqual([2, 3]);
});

test("recorded times avoid the slow file sharing an even-count shard", () => {
  const files = ["a", "b", "c", "d"];
  const times: Readonly<Record<string, number>> = { a: 10, b: 3, c: 3, d: 3 };
  const shards = [1, 2].map((index) => shardFiles(files, times, { index, count: 2 }));
  const load = (shard: readonly string[]) => shard.reduce((sum, file) => sum + (times[file] ?? 0), 0);
  expect(Math.max(...shards.map(load))).toBeLessThan(Math.max(load(files.slice(0, 2)), load(files.slice(2))));
  expect(shards.flat().sort(byText)).toEqual(files);
});

test("invalid and out-of-range shard indices are refused", () => {
  for (const flag of ["--shard=0/2", "--shard=3/2", "--shard=1/0", "--shard=1.5/2"]) expect(parseShard(flag)).toBeUndefined();
  expect(parseShard("--shard=1/2")).toEqual({ index: 1, count: 2 });
});
