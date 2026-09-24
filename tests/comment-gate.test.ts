import { expect, test } from "bun:test";
import { Effect } from "effect";
import { parseAddedLines } from "../scripts/comment-gate.ts";
import { refused } from "../scripts/comments.ts";

const DIFF = [
  "diff --git src/a.ts src/a.ts",
  "index 1111111..2222222 100644",
  "--- src/a.ts",
  "+++ src/a.ts",
  "@@ -1,4 +1,5 @@",
  " const one = 1;",
  "-// @ts-expect-error old suppression",
  "+// @ts-expect-error new suppression",
  " const two = 2;",
  "+// ADR-0007 points at a record",
  " const three = 3;",
  "diff --git src/b.ts src/b.ts",
  "index 3333333..4444444 100644",
  "--- src/b.ts",
  "+++ src/b.ts",
  "@@ -9,3 +9,3 @@",
  " const x = 1;",
  "-// @ts-expect-error untouched suppression",
  "+const x = 2;",
  " const y = 3;",
].join("\n");

test("the gate reads added lines, not whole files", () => {
  const added = parseAddedLines(DIFF);
  expect([...added.get("src/a.ts") ?? []]).toEqual([2, 4]);
  expect([...added.get("src/b.ts") ?? []]).toEqual([10]);
});

test("a violation on an added line is reported with its line", () => {
  const source = ["const one = 1;", "// @ts-expect-error new suppression", "const two = 2;"].join("\n");
  expect(Effect.runSync(refused("src/a.ts", source, new Set([2])))).toEqual([
    "src/a.ts:2 carries the machine-read directive `@ts-expect-error`. Fix what the tool is reporting, or stop running the tool on this file",
  ]);
});

test("a violation on a line the diff did not touch stays silent", () => {
  const source = ["// @ts-expect-error untouched suppression", "const x = 2;"].join("\n");
  expect(Effect.runSync(refused("src/b.ts", source, new Set([2])))).toEqual([]);
});

test("a file the diff never mentions reports nothing whatever it carries", () => {
  const added = parseAddedLines(DIFF);
  expect(added.has("src/c.ts")).toBe(false);
  expect(Effect.runSync(refused("src/c.ts", "// @ts-expect-error silent\n", new Set()))).toEqual([]);
});

test("an added file counts every line, and a new-file hunk parses as added", () => {
  const diff = [
    "diff --git src/new.ts src/new.ts",
    "new file mode 100644",
    "index 0000000..1234567",
    "--- /dev/null",
    "+++ src/new.ts",
    "@@ -0,0 +1,2 @@",
    "+export const one = 1;",
    "+// @ts-ignore fresh suppression",
  ].join("\n");
  const added = parseAddedLines(diff);
  expect([...added.get("src/new.ts") ?? []]).toEqual([1, 2]);
  expect(
    Effect.runSync(
      refused("src/new.ts", "export const one = 1;\n// @ts-ignore fresh suppression\n", added.get("src/new.ts") ?? new Set()),
    ),
  ).toHaveLength(1);
});

test("an opening rationale block counts when any of its lines was added", () => {
  const essay = ["# one", "# two", "# three", "# four", "", "name: x"].join("\n");
  expect(Effect.runSync(refused("suite.yml", essay, new Set([1, 2, 3, 4])))).toHaveLength(1);
  expect(Effect.runSync(refused("suite.yml", essay, new Set([4])))).toHaveLength(1);
  expect(Effect.runSync(refused("suite.yml", essay, new Set([5, 6])))).toEqual([]);
});

test("a directive added inside a block comment is refused, not dropped with its opening line", () => {
  const source = ["const a = 1;", "", "", "", "/* one", " * two", " * eslint-disable-next-line no-eval", " */"].join("\n");
  expect(Effect.runSync(refused("src/a.ts", source, new Set([7])))).toEqual([
    "src/a.ts:5 carries the machine-read directive `eslint-disable-next-line`. Fix what the tool is reporting, or stop running the tool on this file",
  ]);
  expect(Effect.runSync(refused("src/a.ts", source, new Set([1])))).toEqual([]);
});
