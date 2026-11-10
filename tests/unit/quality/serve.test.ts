import { expect, test } from "bun:test";
import { sitePages } from "../../../src/quality/browser/serve.ts";

test("site pages name a directory index by its directory and another page by its file, sorted and once each, instead of naming an index twice or naming a stylesheet", () => {
  const files = new Map([
    ["/notes.html", "dist/notes.html"],
    ["/index.html", "dist/index.html"],
    ["/", "dist/index.html"],
    ["/about/index.html", "dist/about/index.html"],
    ["/about/", "dist/about/index.html"],
    ["/style.css", "dist/style.css"],
  ]);
  expect(sitePages({ files })).toEqual(["/", "/about/", "/notes.html"]);
});
