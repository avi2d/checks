import { expect, test } from "bun:test";
import { focusVerdict, recordFocusVerdict } from "../../../src/quality/browser/keyboard.ts";

test("a scrolled sticky stop with changed paint is reported as unmeasured rather than a page defect", () => {
  const found: string[] = [];
  const notMeasured: string[] = [];
  recordFocusVerdict("link", focusVerdict(true, true), found, notMeasured);
  expect(found).toEqual([]);
  expect(notMeasured).toEqual(["link: Tab scrolled a sticky element, not measured"]);
});

test("a scrolled sticky stop with unchanged paint fails rather than passing as unmeasured", () => {
  const found: string[] = [];
  const notMeasured: string[] = [];
  recordFocusVerdict("link", focusVerdict(true, false), found, notMeasured);
  expect(found).toEqual(["link shows no visible focus when Tab reaches it"]);
  expect(notMeasured).toEqual([]);
});

test("an unscrolled sticky stop with changed paint passes rather than being marked unmeasured", () => {
  const found: string[] = [];
  const notMeasured: string[] = [];
  recordFocusVerdict("link", focusVerdict(false, true), found, notMeasured);
  expect(found).toEqual([]);
  expect(notMeasured).toEqual([]);
});
