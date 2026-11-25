import { expect, test } from "bun:test";
import { compareCrops } from "../../../src/quality/browser/keyboard-crops.ts";

const pixel = (red: number, green = 0, blue = 0) => ({ data: Buffer.from([red, green, blue]) });
const crops = (red: number) => [pixel(red)];

test("a page blur handler that paints after focus is not counted as a focus change", () => {
  expect(compareCrops({ baseline: crops(0), focused: crops(0), blurred: crops(255) })).toBe(false);
});

test("a JavaScript focus ring removed by blur is counted rather than suppressed", () => {
  expect(compareCrops({ baseline: crops(0), focused: crops(255), blurred: crops(0) })).toBe(true);
});

test("a missing baseline still detects whether blur changes the focused pixels", () => {
  expect(compareCrops({ baseline: null, focused: crops(255), blurred: crops(0) })).toBe(true);
  expect(compareCrops({ baseline: null, focused: crops(255), blurred: crops(255) })).toBe(false);
});

test("scroll-only paint that remains after blur is not counted as visible focus", () => {
  expect(compareCrops({ baseline: crops(0), focused: crops(255), blurred: crops(255) })).toBe(false);
});

test("changes in separate later regions are not lost by requiring both changes in one region", () => {
  expect(compareCrops({
    baseline: [pixel(0), pixel(0), pixel(255)],
    focused: [pixel(0), pixel(255), pixel(255)],
    blurred: [pixel(0), pixel(255), pixel(0)],
  })).toBe(true);
});

test.each([
  [0, 255, 0],
  [0, 0, 255],
])("a ring painted with RGB %p %p %p is not missed by comparing only red", (red, green, blue) => {
  expect(compareCrops({
    baseline: crops(0),
    focused: [pixel(red, green, blue)],
    blurred: crops(0),
  })).toBe(true);
});
