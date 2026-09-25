import { expect, test } from "bun:test";
import { findEntry, overdueOf, QUARANTINE_DAYS, report } from "../scripts/quarantine-clock.ts";

const DAY = 86400;
const FILE = "tests/quarantine/billing.test.ts";

function log(blocks: readonly string[]): string {
  return blocks.join("");
}

function commit(sha: string, at: number, day: string, statuses: readonly string[]): string {
  const fields = statuses.flatMap((status) => status.split("\t"));
  return `commit ${sha} ${at} ${day}T10:00:00+00:00\0\n${fields.map((field) => `${field}\0`).join("")}`;
}

const HEAD_SHA = "d".repeat(40);
const ENTRY_SHA = "e".repeat(40);
const ENTRY_AT = 1785578400;

test("a file created directly in quarantine enters at its adding commit", () => {
  const output = log([
    commit(HEAD_SHA, ENTRY_AT + 40 * DAY, "2026-09-10", [`M\t${FILE}`]),
    commit(ENTRY_SHA, ENTRY_AT, "2026-08-01", [`A\t${FILE}`]),
  ]);
  expect(findEntry(output, FILE)).toEqual({ kind: "entered", sha: ENTRY_SHA, at: ENTRY_AT, day: "2026-08-01" });
});

test("a move into quarantine enters at the rename, not at the earlier creation outside", () => {
  const created = "c".repeat(40);
  const output = log([
    commit(HEAD_SHA, ENTRY_AT + 40 * DAY, "2026-09-10", [`M\t${FILE}`]),
    commit(ENTRY_SHA, ENTRY_AT, "2026-08-01", [`R100\ttests/billing.test.ts\t${FILE}`]),
    commit(created, ENTRY_AT - 60 * DAY, "2026-06-02", ["A\ttests/billing.test.ts"]),
  ]);
  expect(findEntry(output, FILE)).toEqual({ kind: "entered", sha: ENTRY_SHA, at: ENTRY_AT, day: "2026-08-01" });
});

test("a rename inside quarantine keeps walking to the entry", () => {
  const moved = "b".repeat(40);
  const before = "tests/quarantine/ledger.test.ts";
  const output = log([
    commit(HEAD_SHA, ENTRY_AT + 40 * DAY, "2026-09-10", [`R100\t${before}\t${FILE}`]),
    commit(moved, ENTRY_AT + 10 * DAY, "2026-08-11", [`R100\ttests/ledger.test.ts\t${before}`]),
  ]);
  expect(findEntry(output, FILE)).toEqual({ kind: "entered", sha: moved, at: ENTRY_AT + 10 * DAY, day: "2026-08-11" });
});

test("statuses of other files in the same commits are passed over", () => {
  const output = log([
    commit(HEAD_SHA, ENTRY_AT + 40 * DAY, "2026-09-10", ["M\tsrc/other.ts", `M\t${FILE}`]),
    commit(ENTRY_SHA, ENTRY_AT, "2026-08-01", ["A\tsrc/other.ts", `A\t${FILE}`]),
  ]);
  expect(findEntry(output, FILE)).toEqual({ kind: "entered", sha: ENTRY_SHA, at: ENTRY_AT, day: "2026-08-01" });
});

test("a history that ends before any entry is truncated rather than dated", () => {
  const output = log([commit(HEAD_SHA, ENTRY_AT + 40 * DAY, "2026-09-10", [`M\t${FILE}`])]);
  expect(findEntry(output, FILE)).toEqual({ kind: "truncated" });
  expect(findEntry("", FILE)).toEqual({ kind: "truncated" });
});

test("the limit is 30 days, and exactly 30 days still passes", () => {
  expect(QUARANTINE_DAYS).toBe(30);
  const entry = { file: FILE, at: ENTRY_AT, day: "2026-08-01" };
  expect(overdueOf([entry], ENTRY_AT + 30 * DAY)).toEqual([]);
  expect(overdueOf([entry], ENTRY_AT + 30 * DAY + 1)).toEqual([{ file: FILE, day: "2026-08-01", days: 30 }]);
  expect(overdueOf([entry], ENTRY_AT + 45 * DAY)).toEqual([{ file: FILE, day: "2026-08-01", days: 45 }]);
});

test("overdue files are sorted by path", () => {
  const entries = [
    { file: "tests/quarantine/z.test.ts", at: ENTRY_AT, day: "2026-08-01" },
    { file: "tests/quarantine/a.test.ts", at: ENTRY_AT, day: "2026-08-01" },
  ];
  expect(overdueOf(entries, ENTRY_AT + 31 * DAY).map((file) => file.file)).toEqual([
    "tests/quarantine/a.test.ts",
    "tests/quarantine/z.test.ts",
  ]);
});

test("the report names each overdue file with its entry day and what to do", () => {
  expect(report({ checked: 0, overdue: [] })).toBe("quarantine-clock: no test in tests/quarantine/ is past 30 days (0 checked)");
  expect(report({ checked: 2, overdue: [] })).toBe("quarantine-clock: no test in tests/quarantine/ is past 30 days (2 checked)");
  expect(
    report({ checked: 1, overdue: [{ file: FILE, day: "2026-08-01", days: 45 }] }),
  ).toBe(
    [
      "quarantine-clock: 1 test(s) in tests/quarantine/ is past 30 days; fix each and move it back, or delete it:",
      "  tests/quarantine/billing.test.ts entered quarantine on 2026-08-01 (45 days ago)",
    ].join("\n"),
  );
});
