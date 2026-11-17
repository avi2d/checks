import { expect, test } from "bun:test";
import { isOnBranch } from "../../../../src/delivery/ci/pages-staged-commit.ts";

test.each([
  ["identical", true],
  ["behind", true],
  ["ahead", false],
  ["diverged", false],
])("a commit compared as %p read as on the branch other than %p fails", (status, onBranch) => {
  expect(isOnBranch(status)).toBe(onBranch);
});
