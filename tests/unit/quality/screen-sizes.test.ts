import { expect, test } from "bun:test";
import { screenSetFor } from "../../../src/quality/browser/screen-sizes.ts";

test("screenSetFor gives a push the anchor set, instead of the full set", () => {
  expect(screenSetFor("push")).toBe("full");
});

test("screenSetFor gives a pull request the full set, instead of the anchor set", () => {
  expect(screenSetFor("pull_request")).toBe("anchor");
});

test("screenSetFor gives a run with no event name the anchor set, instead of the full set", () => {
  expect(screenSetFor(undefined)).toBe("full");
});
