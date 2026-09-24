import { expect, test } from "bun:test";
import { Effect } from "effect";
import {
  compareSuppressions,
  parseSuppressions,
  report,
  type Suppressions,
  SuppressionsError,
} from "../scripts/suppressions-ratchet.ts";

function suppressions(entries: Record<string, Record<string, number>>): Suppressions {
  return new Map(Object.entries(entries).map(([file, rules]) => [file, new Map(Object.entries(rules))]));
}

const BASE = suppressions({
  "src/dispatch.ts": { "typescript/no-non-null-assertion": 12, "typescript/no-unsafe-type-assertion": 3 },
  "src/glob.ts": { "typescript/no-non-null-assertion": 1 },
});

test("oxlint's file parses into a count per rule per file", () => {
  const text = JSON.stringify({
    "src/dispatch.ts": {
      "typescript/no-non-null-assertion": { count: 12 },
      "typescript/no-unsafe-type-assertion": { count: 3 },
    },
    "src/glob.ts": { "typescript/no-non-null-assertion": { count: 1 } },
  });
  expect(Effect.runSync(parseSuppressions(text, "base"))).toEqual(BASE);
});

test("a raised count goes red naming its file and rule", () => {
  const head = suppressions({
    "src/dispatch.ts": { "typescript/no-non-null-assertion": 13, "typescript/no-unsafe-type-assertion": 3 },
    "src/glob.ts": { "typescript/no-non-null-assertion": 1 },
  });
  const ratchet = compareSuppressions(BASE, head);
  expect(ratchet.rises).toEqual([
    { kind: "rose", file: "src/dispatch.ts", rule: "typescript/no-non-null-assertion", base: 12, head: 13 },
  ]);
  expect(report(ratchet)).toBe(
    [
      "suppressions-ratchet: 1 count(s) in oxlint-suppressions.json rose or appeared; fix the site instead of suppressing it:",
      "  src/dispatch.ts typescript/no-non-null-assertion rose from 12 to 13",
    ].join("\n"),
  );
});

test("a new rule in a counted file and a new file both go red as appeared", () => {
  const head = suppressions({
    "src/dispatch.ts": { "typescript/no-non-null-assertion": 12, "typescript/no-unsafe-type-assertion": 3 },
    "src/glob.ts": { "typescript/no-non-null-assertion": 1, "typescript/no-unsafe-type-assertion": 2 },
    "src/added.ts": { "typescript/no-unsafe-type-assertion": 1 },
  });
  const ratchet = compareSuppressions(BASE, head);
  expect(ratchet.rises).toEqual([
    { kind: "appeared", file: "src/added.ts", rule: "typescript/no-unsafe-type-assertion", head: 1 },
    { kind: "appeared", file: "src/glob.ts", rule: "typescript/no-unsafe-type-assertion", head: 2 },
  ]);
  const text = report(ratchet);
  expect(text).toContain("  src/added.ts typescript/no-unsafe-type-assertion appeared with 1");
  expect(text).toContain("  src/glob.ts typescript/no-unsafe-type-assertion appeared with 2");
});

test("a lowered count and a vanished entry pass and are tallied", () => {
  const head = suppressions({
    "src/dispatch.ts": { "typescript/no-non-null-assertion": 11, "typescript/no-unsafe-type-assertion": 3 },
  });
  const ratchet = compareSuppressions(BASE, head);
  expect(ratchet).toEqual({ counted: 2, lowered: 2, rises: [] });
  expect(report(ratchet)).toBe(
    "suppressions-ratchet: no count in oxlint-suppressions.json rose or appeared (2 at the head, 2 lowered)",
  );
});

test("an unchanged file passes", () => {
  expect(compareSuppressions(BASE, BASE)).toEqual({ counted: 3, lowered: 0, rises: [] });
});

test("an empty base makes every counted entry at the head appear", () => {
  const ratchet = compareSuppressions(new Map(), BASE);
  expect(ratchet.rises.map((rise) => rise.kind)).toEqual(["appeared", "appeared", "appeared"]);
});

test("a zero count at the head is not a rise", () => {
  const head = suppressions({ "src/added.ts": { "typescript/no-unsafe-type-assertion": 0 } });
  expect(compareSuppressions(new Map(), head).rises).toEqual([]);
});

test("a file that is not oxlint's shape is refused with where it was read", () => {
  const refusals: ReadonlyArray<readonly [string, string]> = [
    ["{", "is not valid JSON"],
    ["[]", "is not an object of files"],
    ['{"a.ts": 3}', "holds a.ts without an object of rules"],
    ['{"a.ts": {"no-debugger": 3}}', "holds a.ts no-debugger without a whole count"],
    ['{"a.ts": {"no-debugger": {"count": -1}}}', "holds a.ts no-debugger without a whole count"],
    ['{"a.ts": {"no-debugger": {"count": 1.5}}}', "holds a.ts no-debugger without a whole count"],
    ['{"a.ts": {"no-debugger": {"count": "1"}}}', "holds a.ts no-debugger without a whole count"],
  ];
  for (const [text, reason] of refusals) {
    expect(() => Effect.runSync(parseSuppressions(text, "head"))).toThrow(SuppressionsError);
    expect(() => Effect.runSync(parseSuppressions(text, "head"))).toThrow(`head ${reason}`);
  }
});
