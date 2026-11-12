import { expect, test } from "bun:test";
import { sameSiteLinks } from "../../../src/quality/browser/links.ts";

const ORIGIN = "http://127.0.0.1:4321";

test("a same-site link keeps its fragment and is judged against the page it points at, instead of the linking page", () => {
  expect(sameSiteLinks(ORIGIN, [`${ORIGIN}/fees/#about`])).toEqual([{ shown: "/fees/#about", document: `${ORIGIN}/fees/`, fragment: "about" }]);
});

test("top in any case names no fragment to look for, instead of refusing the start of the document", () => {
  expect(sameSiteLinks(ORIGIN, [`${ORIGIN}/#top`, `${ORIGIN}/#TOP`]).map(({ fragment }) => fragment)).toEqual([undefined, undefined]);
});

test("a percent-encoded fragment is decoded to the name an element carries, instead of compared as raw text", () => {
  expect(sameSiteLinks(ORIGIN, [new URL("/#услуги", ORIGIN).href]).map(({ fragment }) => fragment)).toEqual(["услуги"]);
});

test("a fragment that does not decode is looked for as written, instead of ending the run", () => {
  expect(sameSiteLinks(ORIGIN, [`${ORIGIN}/#100%`]).map(({ fragment }) => fragment)).toEqual(["100%"]);
});

test("another site's links and a mail link are left alone, instead of judged against this site", () => {
  expect(sameSiteLinks(ORIGIN, ["https://t.me/channel#post", "mailto:wren@example.com", "http://127.0.0.1:9999/#x"])).toEqual([]);
});

test("a link the page repeats is judged once, instead of reported once for each copy", () => {
  expect(sameSiteLinks(ORIGIN, [`${ORIGIN}/gone/`, `${ORIGIN}/gone/`])).toEqual([{ shown: "/gone/", document: `${ORIGIN}/gone/`, fragment: undefined }]);
});
