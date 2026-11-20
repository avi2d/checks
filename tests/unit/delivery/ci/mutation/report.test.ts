import { expect, test } from "bun:test";
import { scoreSummary, shardsOf, type Report } from "../../../../../src/delivery/ci/mutation/report.ts";

const reportOf = (statuses: readonly string[]): Report => ({
  files: { "src/a.ts": { mutants: statuses.map((status) => ({ status })) } },
});

test("a score that leaves out a timeout mutant fails", () => {
  expect(scoreSummary("mutation refresh", reportOf(["Killed", "Timeout", "Survived", "NoCoverage"]))).toBe(
    "## mutation refresh

Detected 2 of 4 mutants (50%).
",
  );
});

test("a score that counts a survived mutant as detected fails", () => {
  expect(scoreSummary("mutation refresh", reportOf(["Killed", "Survived"]))).toBe("## mutation refresh

Detected 1 of 2 mutants (50%).
");
});

test("a score that counts an ignored mutant in the total fails", () => {
  expect(scoreSummary("mutation refresh", reportOf(["Killed", "Ignored", "RuntimeError", "CompileError", "Pending"]))).toBe(
    "## mutation refresh

Detected 1 of 1 mutants (100%).
",
  );
});

test("a score that truncates a half percent down fails", () => {
  expect(scoreSummary("mutation refresh", reportOf(["Killed", "Survived", "Survived", "Survived", "Survived", "Survived"]))).toBe(
    "## mutation refresh

Detected 1 of 6 mutants (17%).
",
  );
});

test("a score with no scored mutant that divides by zero fails", () => {
  expect(scoreSummary("mutation refresh", reportOf([]))).toBe("## mutation refresh

Detected 0 of 0 mutants.
");
});

test("a missing report that prints a score of zero fails", () => {
  expect(scoreSummary("mutation refresh", undefined)).toBe("## mutation refresh

No report was written.
");
});

test("a scope line that is read past the SHARDS prefix fails", () => {
  expect(shardsOf('mutation-scope: shard 1 holds 2 file(s) and about 9 mutant(s)
SHARDS=["src/a.ts,src/b.ts","src/c.ts"]
')).toBe(
    '["src/a.ts,src/b.ts","src/c.ts"]',
  );
});

test("a scope output with no SHARDS line that returns an empty shard list fails", () => {
  expect(shardsOf("mutation-scope: shard 1 holds 2 file(s) and about 9 mutant(s)
")).toBeUndefined();
});
