import { expect, test } from "bun:test";
import { Effect } from "effect";
import { judgeTestFileTimes, resolveTestFileMaxSeconds } from "../../../src/testing/test-file-time.ts";

function judgeAtDefault(xml: string): boolean {
  return Effect.runSync(resolveTestFileMaxSeconds(undefined).pipe(Effect.flatMap((limit) => judgeTestFileTimes(xml, limit))));
}

test("the default does not reject a file at exactly five minutes or add times across files", () => {
  expect(judgeAtDefault(`
    <testsuites time="500">
      <testsuite name="tests/unit/a.test.ts" file="tests/unit/a.test.ts" time="300" />
      <testsuite name="tests/unit/b.test.ts" file="tests/unit/b.test.ts" time="200" />
    </testsuites>
  `)).toBe(true);
});

test("the default rejects a file just over five minutes without rounding down", () => {
  expect(judgeAtDefault(`
    <testsuites time="300.001">
      <testsuite name="tests/unit/a.test.ts" file="tests/unit/a.test.ts" time="300.001" />
    </testsuites>
  `)).toBe(false);
});
