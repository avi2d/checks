import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { judge, placementOf, placementProblem } from "../scripts/doc-rules.ts";
import { KINDS, type Kind } from "../scripts/doc-templates.ts";

const FIXTURES = resolve(import.meta.dir, "fixtures", "docs");
const RECORD = "docs/adr/0001-a-part-names-its-supplier.md";

function fixture(kind: Kind): string {
  return readFileSync(resolve(FIXTURES, `${kind}.md`), "utf8");
}

function found(kind: Kind, text: string, path = kind === "adr" ? RECORD : `docs/${kind}.md`, records = [RECORD]): readonly string[] {
  return judge(kind, { path, text }, records).map(({ line, message }) => `${line}: ${message}`);
}

test("a root file, a record and a declared page each map to their kind, and other Markdown is left alone", () => {
  const docs = { pages: { reference: ["docs/gates/*.md", "docs/design.md"], explanation: ["docs/design.md"] } };
  const kinds = ["README.md", "CHANGELOG.md", "AGENTS.md", "CLAUDE.md", "docs/adr/0001-x.md", "docs/gates/lint.md"].map((path) =>
    placementOf(path, docs),
  );
  expect(kinds).toEqual(
    (["readme", "changelog", "agents", "claude", "adr", "reference"] as const).map((kind) => ({ type: "judged", kind })),
  );
  expect(["docs/adr/README.md", "src/README.md", "notes.md", "docs/image.png"].map((path) => placementOf(path, docs).type)).toEqual([
    "unjudged",
    "unjudged",
    "unjudged",
    "unjudged",
  ]);
  expect(placementProblem(placementOf("docs/stack/cross.md", docs))).toBe(
    "is a page under docs/ with no mode; declare it under docs.pages in quality.json as tutorial, how-to, reference, explanation",
  );
  expect(placementProblem(placementOf("docs/design.md", docs))).toBe(
    "is declared under docs.pages as reference and explanation, and a page has one mode",
  );
});

test("a filled-in document of every kind holds to its template", () => {
  expect(Object.fromEntries(KINDS.map((kind) => [kind, found(kind, fixture(kind))]))).toEqual(
    Object.fromEntries(KINDS.map((kind) => [kind, []])),
  );
});

test("a README missing a section is refused", () => {
  const readme = fixture("readme");
  expect(found("readme", readme.replace("## Before you begin\n\n- Bun 1.3.13 or later.\n\n", ""))).toEqual([
    "1: lacks `## Before you begin`",
  ]);
});

test("a record is refused for its name, its number, its date, its status and a number another record holds", () => {
  const record = fixture("adr");
  expect(found("adr", record, "docs/adr/first-record.md")).toEqual([
    "1: is not named as a record, a four-digit number and a kebab-case name directly in docs/adr/",
  ]);
  expect(found("adr", record.replace("# 1.", "# 2."))).toEqual(["1: `# 2. A part names its supplier` carries number 2, and the file name 1"]);
  expect(found("adr", record.replace("# 1. ", "# "))).toEqual([
    "1: `# A part names its supplier` does not open with the record's number, as in `# 7. The decision`",
  ]);
  expect(found("adr", record.replace("Date: 2026-09-24", "Date: 2026-02-30"))).toEqual([
    "3: does not follow its title with a `Date: YYYY-MM-DD` line",
  ]);
  expect(found("adr", record.replace("Accepted.", "Maybe."))).toEqual([
    "7: `## Status` opens with `Maybe` where one of Proposed, Accepted, Rejected, Deprecated, Superseded, Retired goes",
  ]);
  expect(found("adr", record, RECORD, [RECORD, "docs/adr/0001-another.md"])).toEqual(["1: shares number 1 with docs/adr/0001-another.md"]);
  expect(found("adr", record.replace("## Decision\n\nA part names its supplier.\n\n", ""))).toEqual(["1: lacks `## Decision`"]);
});

test("a changelog is refused for a release out of order, a release without its date and a group it does not know", () => {
  const changelog = fixture("changelog");
  expect(found("changelog", changelog.replace("## 1.0.0", "## 1.2.0"))).toEqual([
    "17: `## 1.2.0` follows `## 1.1.0`, and releases run newest first",
  ]);
  expect(found("changelog", changelog.replace("Released 2026-09-24.", "Out now."))).toEqual([
    "7: `## 1.1.0` does not open with a `Released YYYY-MM-DD.` line",
  ]);
  expect(found("changelog", changelog.replace("### Fixes", "### Chores"))).toEqual([
    "13: `### Chores` is not a section the template has there, as the template's order is Breaking changes, Features, Fixes, Performance, Reverts",
  ]);
  expect(found("changelog", changelog.replace("## 1.1.0", "## Next"))).toEqual(["5: `## Next` is not a version such as 1.2.0"]);
});

test("CLAUDE.md is the template word for word, and a line added or changed is refused where it starts", () => {
  expect(found("claude", `${fixture("claude")}Read the README too.\n`)).toEqual([
    "3: differs from templates/claude.md, which it holds word for word",
  ]);
  expect(found("claude", fixture("claude").replace("@AGENTS.md", "@README.md"))).toEqual([
    "2: differs from templates/claude.md, which it holds word for word",
  ]);
});

test("each mode's page is held to its own shape", () => {
  expect(found("tutorial", fixture("tutorial").replace("# Tutorial: ", "# "))).toEqual([
    "1: `# Build your first bill of materials` does not open with `Tutorial: `",
  ]);
  expect(found("how-to", fixture("how-to").replace(/^1\. /gm, "- "))).toEqual(["1: numbers no steps, which a how-to page lists as `1.` items"]);
  expect(found("reference", fixture("reference").replace("## Fields", "## Overview"))).toEqual([
    "5: `## Overview` names no topic; title it by what the reader does or looks up",
  ]);
  expect(found("explanation", `${fixture("explanation")}\n# Suppliers again\n`)).toEqual(["10: `# Suppliers again` is a second title"]);
  expect(found("agents", fixture("agents").replace("# Project agent memory", "# widget"))).toEqual([
    "1: `# widget` is not the template's title, `# Project agent memory`",
  ]);
});
