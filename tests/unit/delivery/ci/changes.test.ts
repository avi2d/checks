import { expect, test } from "bun:test";
import { testsOnly } from "../../../../src/delivery/ci/changes.ts";

test("unit and e2e tests and helpers do not require a site build", () => {
  expect(testsOnly(["tests/unit/a.test.ts", "tests/e2e/b/c.test.tsx", "tests/unit/helper.ts", "tests/e2e/helper.tsx"])).toBe(true);
});

test.each([[[]], [["tests/pixel/a.test.ts"]], [["tests/quarantine/unit/a.test.ts"]], [["tests/unit/a.test.ts", "src/a.ts"]], [["tests/lib/helper.ts"]]])(
  "a change of %p read as tests alone fails",
  (changed) => {
    expect(testsOnly(changed)).toBe(false);
  },
);
