import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { repeatedVisionFindings, requiresName, shapeFindings, shortName, trioFindings, visionPools } from "../../../src/docs/doc-vision.ts";

const FIXTURES = resolve(import.meta.dir, "..", "..", "fixtures", "docs");

const OPENING = ["widget builds a bill of materials from a parts list.", "Makers who price a build read it before they buy.", "It owns the priced bill and nothing past it."];

function vision(body: readonly string[]): string {
  return ["# Vision", "", ...OPENING, "", ...body].join("\n") + "\n";
};

const STANCE = ["## Price before purchase", "", "- It prices the build alone, it never orders a part, and it takes the trade of a bill that never leaves the desk."];
const SCOPE = ["## Scope", "", "- Ordering belongs to the shop, and stock belongs to the inventory tool."];
const CLOSING = ["A change aligns when it makes the bill cheaper to trust.", "A change should be resisted when it moves the bill past pricing."];

const WHOLE = vision([...STANCE, "", ...SCOPE, "", ...CLOSING]);

test("a vision without the aligns closing line is refused naming that line rather than passing on the resisted line", () => {
  expect(shapeFindings(vision([...STANCE, "", ...SCOPE, "", ...CLOSING.slice(1)]))).toEqual([
    { line: 1, message: "lacks an `A change aligns when ...` closing line" },
  ]);
  expect(shapeFindings(vision([...STANCE, "", ...SCOPE]))).toEqual([
    { line: 1, message: "lacks an `A change aligns when ...` closing line" },
    { line: 1, message: "lacks an `A change should be resisted when ...` closing line" },
  ]);
});

test("a vision holding both closing lines passes the shape rather than failing what the template already holds", () => {
  expect(shapeFindings(WHOLE)).toEqual([]);
});

const README = "# widget\n\nThe tools build bills.\n";
const AGENTS = "# Project agent memory\n\nThe fixture builds bills, and README.md holds what a person reads.\n";

function repeated(visionText: string): readonly string[] {
  return repeatedVisionFindings(visionText, [
    { path: "README.md", text: README },
    { path: "AGENTS.md", text: AGENTS },
  ]).map(({ line, message }) => line + ": " + message);
}

test("a line shared with the readme fails naming the line rather than passing as a fresh rule", () => {
  const shared = vision([...STANCE.slice(0, 2), "The tools build bills.", "", ...SCOPE, "", ...CLOSING]);
  expect(repeated(shared)).toEqual([expect.stringContaining('9: repeats a line from README.md: "The tools build bills."')]);
});

test("a line shared with the agent file fails naming that file rather than only reading the readme", () => {
  const shared = vision([...STANCE, "", ...SCOPE.slice(0, 2), "The fixture builds bills, and README.md holds what a person reads.", "", ...CLOSING]);
  expect(repeated(shared)).toEqual([
    expect.stringContaining('13: repeats a line from AGENTS.md: "The fixture builds bills, and README.md holds what a person reads."'),
  ]);
});

test("a heading or a fenced line matching another file is not a repeated line", () => {
  const headed = vision(["## The tools build bills", "", ...STANCE, "", ...SCOPE, "", ...CLOSING]);
  expect(repeated(headed)).toEqual([]);
  const fenced = vision([...STANCE, "", "```", "The tools build bills.", "```", "", ...SCOPE, "", ...CLOSING]);
  expect(repeated(fenced)).toEqual([]);
});

test("a scoped kit name requires a vision and a personal name leaves it advisory rather than failing the range", () => {
  expect(["skills", "checks", "workflows", "orc"].map((name) => requiresName({ name }))).toEqual([true, true, true, true]);
  expect(requiresName({ name: "@avi2dg/checks" })).toBe(true);
  expect(requiresName({ name: "widget" })).toBe(false);
  expect(requiresName(undefined)).toBe(false);
  expect(requiresName(null)).toBe(false);
  expect(requiresName({ name: 7 })).toBe(false);
});
test("a line the readme shares with the agent file is reported on both pages rather than only the vision", () => {
  const pages = new Map([
    ["README.md", "# Widget\n\nShared line.\n"],
    ["AGENTS.md", "# Memory\n\nShared line.\n"],
  ]);
  expect(trioFindings(pages).map(({ path }) => path).toSorted()).toEqual(["AGENTS.md", "README.md"]);
});

test("a vision pool holds the vision findings while the template pool holds the rest rather than mixing them", () => {
  const templated = [
    { path: "VISION.md", line: 1, message: "lacks a closing line" },
    { path: "README.md", line: 2, message: "lacks a section" },
  ];
  const { vision: visionPool, template: templatePool } = visionPools(templated, new Map([["VISION.md", "# Vision\n\nAlone.\n"]]));
  expect(visionPool.map(({ path }) => path)).toEqual(["VISION.md"]);
  expect(templatePool.map(({ path }) => path)).toEqual(["README.md"]);
});

test("a manifest name shortens past its scope rather than comparing the scope", () => {
  expect(shortName("@avi2dg/checks")).toBe("checks");
  expect(shortName("orc")).toBe("orc");
});

test("a table row shared with another file passes rather than comparing tables", () => {
  const table = "| Path | Purpose |\n| --- | --- |\n| src/ | Builds. |";
  expect(repeatedVisionFindings(vision([table, "", ...CLOSING]), [{ path: "README.md", text: "# widget\n\n" + table + "\n" }])).toEqual([]);
});

test("an indented code line shared with another file passes rather than comparing code", () => {
  expect(
    repeatedVisionFindings(vision([...STANCE, "", ...SCOPE, "", "    The tools build bills.", "", ...CLOSING]), [
      { path: "README.md", text: "# widget\n\n    The tools build bills.\n" },
    ]),
  ).toEqual([]);
});

test("lines differing only in case pass rather than folding the case", () => {
  const cased = vision([...STANCE.slice(0, 2), "The Tools Build Bills.", "", ...SCOPE, "", ...CLOSING]);
  expect(repeated(cased)).toEqual([]);
});

test("lines differing only in markup pass rather than stripping the markup", () => {
  const marked = vision([...STANCE.slice(0, 2), "- **The tools build bills.**", "", ...SCOPE, "", ...CLOSING]);
  expect(repeatedVisionFindings(marked, [{ path: "README.md", text: "# widget\n\n- The tools build bills.\n" }])).toEqual([]);
});

test("a bulleted line does not repeat a bare line rather than stripping the marker", () => {
  const bulleted = vision([...STANCE.slice(0, 2), "- The tools build bills.", "", ...SCOPE, "", ...CLOSING]);
  expect(repeated(bulleted)).toEqual([]);
});

test("a sentence wrapped across lines passes rather than joining the continuation", () => {
  const wrapped = vision([...STANCE.slice(0, 2), "- The tools build", "bills.", "", ...SCOPE, "", ...CLOSING]);
  expect(repeatedVisionFindings(wrapped, [{ path: "README.md", text: "# widget\n\n- The tools build bills.\n" }])).toEqual([]);
});

test("the firstmate vision passes the shape and repeats no line of an empty shelf", () => {
  const model = readFileSync(resolve(FIXTURES, "vision-firstmate.md"), "utf8");
  expect(shapeFindings(model)).toEqual([]);
  expect(repeatedVisionFindings(model, [])).toEqual([]);
});
