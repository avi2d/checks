import { expect, test } from "bun:test";
import { matchSections, outlineProblems, parseOutline, verbFirstProblem, type Slot } from "../scripts/doc-outline.ts";

const REQUIRED = { required: true } as const;
const OPTIONAL = { required: false, omitWhen: "never" } as const;

function fixed(text: string, more: Partial<Extract<Slot, { type: "fixed" }>> = {}): Slot {
  return { type: "fixed", text, presence: REQUIRED, body: [], ...more };
}

function open(placeholder: string, more: Partial<Extract<Slot, { type: "open" }>> = {}): Slot {
  return { type: "open", placeholder, rule: "any", presence: REQUIRED, body: [], ...more };
}

function problems(text: string, slots: readonly Slot[]): readonly string[] {
  return matchSections(parseOutline(text).sections, slots, 2, 1).map(({ line, message }) => `${line}: ${message}`);
}

test("a heading inside a code fence is not a heading, and the fence may use tildes or more backticks", () => {
  const outline = parseOutline(["# t", "", "```sh", "# not a heading", "```", "~~~~", "## nor this", "~~~~", "## real ##"].join("\n"));
  expect(outline.headings.map(({ level, title, line }) => `${line}:${level}:${title}`)).toEqual(["1:1:t", "9:2:real"]);
});

test("the lead is what sits between the title and the first heading, and a section holds its own subsections", () => {
  const outline = parseOutline(["# t", "", "lead", "## A", "a body", "### A1", "## B"].join("\n"));
  expect(outline.lead.map(({ text }) => text)).toEqual(["", "lead"]);
  expect(outline.sections.map(({ heading, body, subsections }) => [heading.title, body.map(({ text }) => text), subsections.map((s) => s.heading.title)])).toEqual([
    ["A", ["a body"], ["A1"]],
    ["B", [], []],
  ]);
});

test("sections in the template's order pass, and each departure is named", () => {
  const slots = [fixed("Before"), open("<task>", { rule: "verb-first" }), fixed("After"), fixed("Last", { presence: OPTIONAL })];
  expect(problems("# t\n\nx\n\n## Before\n\n## Run it\n\n## Build it\n\n## After\n", slots)).toEqual([]);
  expect(problems("# t\n\n## After\n\n## Before\n", slots)).toEqual([
    "5: `## Before` is out of order, as the template's order is Before, <task>, After, Last",
    "1: lacks a `## <task>` section",
  ]);
  expect(problems("# t\n\n## Before\n\n## Run it\n\n## Before\n\n## After\n\n## Stray\n", slots)).toEqual([
    "7: `## Before` is out of order, as the template's order is Before, <task>, After, Last",
    "11: `## Stray` is not a section the template has there, as the template's order is Before, <task>, After, Last",
  ]);
  expect(problems("# t\n\n## Before\n\n## Installing\n\n## After\n\n## After\n", slots)).toEqual([
    "5: `## Installing` opens with `Installing`, which is not on the kit's list of imperative verbs",
    "9: `## After` appears twice",
  ]);
});

test("an interleaved open section may follow the fixed sections after it, and a plain one may not", () => {
  const slots = (interleaved: boolean): readonly Slot[] => [
    fixed("Context"),
    open("<extra>", { presence: OPTIONAL, ...(interleaved ? { interleaved: true } : {}) }),
    fixed("Decision", { also: ["Decisions"] }),
  ];
  const text = "# t\n\n## Context\n\n## Decisions\n\n## Rejected\n";
  expect(problems(text, slots(true))).toEqual([]);
  expect(problems(text, slots(false))).toEqual([
    "7: `## Rejected` is not a section the template has there, as the template's order is Context, <extra>, Decision",
  ]);
});

test("a section's subsections are held to its own slots", () => {
  const slots = [fixed("Troubleshooting", { subsections: [open("<symptom>")] })];
  expect(problems("# t\n\n## Troubleshooting\n\n### It hangs\n", slots)).toEqual([]);
  expect(problems("# t\n\n## Troubleshooting\n\nnothing\n", slots)).toEqual(["3: lacks a `### <symptom>` section"]);
});

test("a document opens with one title, skips no level and names no Overview", () => {
  const found = (text: string) => outlineProblems(parseOutline(text)).map(({ line, message }) => `${line}: ${message}`);
  expect(found("# t\n\nlead\n\n## A\n\n### B\n")).toEqual([]);
  expect(found("\n# t\n\nlead\n")).toEqual(["1: does not open with a `# ` title on its first line"]);
  expect(found("# t\n\nlead\n\n#### Deep\n\n# Again\n\nx\n\n## Overview\n")).toEqual([
    "5: `#### Deep` skips a level under `# t`",
    "7: `# Again` is a second title",
    "11: `## Overview` names no topic; title it by what the reader does or looks up",
  ]);
  expect(found("# t\n## A\n")).toEqual(["1: has nothing between its title and its first section"]);
});

test("a verb-first heading opens with a verb on the kit's list, and any other first word is refused", () => {
  expect(["Install it", "Bring a part", "Focus the view", "Run `widget`", "Develop", "Declare policy in the quality file"].map(verbFirstProblem)).toEqual([
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
  ]);
  expect(["Quality file", "Size budget", "The commands", "Why it is shaped this way", "Installing into $HOME", "Spring"].map(verbFirstProblem)).toEqual([
    "opens with `Quality`, which is not on the kit's list of imperative verbs",
    "opens with `Size`, which is not on the kit's list of imperative verbs",
    "opens with `The`, which is not on the kit's list of imperative verbs",
    "opens with `Why`, which is not on the kit's list of imperative verbs",
    "opens with `Installing`, which is not on the kit's list of imperative verbs",
    "opens with `Spring`, which is not on the kit's list of imperative verbs",
  ]);
});
