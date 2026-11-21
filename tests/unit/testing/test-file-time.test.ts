import { expect, test } from "bun:test";
import { Effect } from "effect";
import { judgeTestFileTimes, resolveTestFileMaxSeconds } from "../../../src/testing/test-file-time.ts";

function judgeAtDefault(xml: string): boolean {
  return Effect.runSync(resolveTestFileMaxSeconds(undefined).pipe(Effect.flatMap((limit) => judgeTestFileTimes(xml, limit))));
}

test("the default does not fail fast files whose combined time exceeds two minutes", () => {
  expect(judgeAtDefault(`
    <testsuites time="122">
      <testsuite name="tests/unit/a.test.ts" file="tests/unit/a.test.ts" time="61" />
      <testsuite name="tests/unit/b.test.ts" file="tests/unit/b.test.ts" time="61" />
    </testsuites>
  `)).toBe(true);
});

test("the default does not fail a file at exactly two minutes", () => {
  expect(judgeAtDefault(`
    <testsuites time="120">
      <testsuite name="tests/unit/a.test.ts" file="tests/unit/a.test.ts" time="120" />
    </testsuites>
  `)).toBe(true);
});

test("the default does not pass a slow file just over two minutes", () => {
  expect(judgeAtDefault(`
    <testsuites time="120.001">
      <testsuite name="tests/unit/a.test.ts" file="tests/unit/a.test.ts" time="120.001" />
    </testsuites>
  `)).toBe(false);
});

test("a repository cannot raise the CI limit above two minutes", () => {
  expect(Effect.runSync(resolveTestFileMaxSeconds(121).pipe(Effect.flip))).toMatchObject({
    _tag: "Usage",
  });
});
