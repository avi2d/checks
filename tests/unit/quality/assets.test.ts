import { expect, test } from "bun:test";
import { fromAnotherOrigin } from "../../../src/quality/browser/assets.ts";

const ORIGIN = "http://127.0.0.1:4173";

test("a request to the page's own origin, or a blob it made, is not from another origin", () => {
  expect(fromAnotherOrigin(ORIGIN, `${ORIGIN}/widget.js`)).toBe(false);
  expect(fromAnotherOrigin(ORIGIN, `blob:${ORIGIN}/0b6f2f5e-8a52-4f1e-9d3c-2f0a1c4b7e11`)).toBe(false);
});

test("a data address has no origin, so it is not counted as another site", () => {
  expect(fromAnotherOrigin(ORIGIN, "data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%2F%3E")).toBe(false);
});

test("another port, host or scheme on the same machine is another origin, not the page's own", () => {
  expect(fromAnotherOrigin(ORIGIN, "http://127.0.0.1:4174/widget.js")).toBe(true);
  expect(fromAnotherOrigin(ORIGIN, "http://localhost:4173/widget.js")).toBe(true);
  expect(fromAnotherOrigin(ORIGIN, "https://127.0.0.1:4173/widget.js")).toBe(true);
  expect(fromAnotherOrigin(ORIGIN, "https://cdn.example.com/widget.js")).toBe(true);
});
