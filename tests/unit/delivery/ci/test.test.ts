import { expect, test } from "bun:test";
import { testCommandOf } from "../../../../src/delivery/ci/test.ts";

test("a release run that runs only the pull request's tests, or a pull request run that runs the whole suite, fails", () => {
  expect(testCommandOf("true")).toEqual({ program: "bun", args: ["run", "test"] });
  expect(testCommandOf("false")).toEqual({ program: "bunx", args: ["checks-test", "--pr"] });
});
