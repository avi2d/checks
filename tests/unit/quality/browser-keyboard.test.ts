import { expect, test } from "bun:test";
import { Effect } from "effect";
import type { Page } from "playwright-core";
import { judgeKeyboard } from "../../../src/quality/browser/keyboard.ts";

const stickyPage = (scroll: { readonly x: number; readonly y: number }) => {
  const moved = scroll.x !== 0 || scroll.y !== 0;
  const leafResults: unknown[] = [
    undefined,
    "main/a:0",
    "0:0",
    { fixed: false, sticky: true },
    undefined,
    "main/a:0",
    "0:0",
    [],
    { fixed: false, sticky: true },
    ...(moved ? [] : [undefined, [], undefined, { compared: true, differs: false }]),
  ];
  const pageResults: unknown[] = [undefined, undefined, { x: 0, y: 0 }, scroll];
  const nextResult = (results: unknown[]) => {
    if (results.length === 0) throw new Error("unexpected browser evaluation");
    return results.shift();
  };
  const leaf = {
    evaluate: () => Promise.resolve(nextResult(leafResults)),
    boundingBox: () => Promise.resolve({ x: 20, y: 20, width: 100, height: 30 }),
  };
  let handles = 0;
  let tabs = 0;
  const page = {
    url: () => "https://example.test/",
    goto: () => Promise.resolve(null),
    viewportSize: () => ({ width: 320, height: 640 }),
    screenshot: () => Promise.resolve(Buffer.from("browser capture")),
    evaluate: () => Promise.resolve(nextResult(pageResults)),
    evaluateHandle: () => {
      handles += 1;
      const present = handles !== 2;
      return Promise.resolve({
        evaluate: () => Promise.resolve(present),
        asElement: () => present ? leaf : null,
      });
    },
    keyboard: { press: () => { tabs += 1; return Promise.resolve(); } },
    locator: () => ({
      count: () => Promise.resolve(tabs % 2),
      filter: () => ({ elementHandles: () => Promise.resolve([leaf]) }),
    }),
  } as unknown as Page;
  return { page, leafResults, pageResults };
};

test.each([
  { x: 400, y: 0 },
  { x: -400, y: 0 },
  { x: 0, y: 400 },
  { x: 0, y: -400 },
])("a sticky stop scrolled to %j is not reported as a page defect", async (scroll) => {
  const { page, leafResults, pageResults } = stickyPage(scroll);
  const result = await Effect.runPromise(judgeKeyboard(page, [{ name: "link", selector: "a", focusable: true }]));
  expect(result.found).toEqual([]);
  expect(result.notMeasured).toEqual(["link: Tab scrolled a sticky element, not measured"]);
  expect([...result.reached]).toEqual([["link", 1]]);
  expect(result.complete).toBe(true);
  expect(leafResults).toEqual([]);
  expect(pageResults).toEqual([]);
});

test("a sticky stop without scrolling still fails when it has no visible focus", async () => {
  const { page, leafResults, pageResults } = stickyPage({ x: 0, y: 0 });
  const result = await Effect.runPromise(judgeKeyboard(page, [{ name: "link", selector: "a", focusable: true }]));
  expect(result.found).toEqual(["link shows no visible focus when Tab reaches it"]);
  expect(result.notMeasured).toEqual([]);
  expect([...result.reached]).toEqual([["link", 1]]);
  expect(result.complete).toBe(true);
  expect(leafResults).toEqual([]);
  expect(pageResults).toEqual([]);
});
