import { describe, expect, test } from "bun:test";
import { isLivingDoc, PROSE_RULES, proseFindings, proseRefused, readerOf, scanMarkdown } from "../scripts/prose-matchers.ts";

function refusals(text: string, within?: ReadonlySet<number>): readonly string[] {
  return proseFindings(text, "people", within).map(({ line, message }) => `${line}: ${message}`);
}

describe("each rule goes red on a planted line and green on its rewrite", () => {
  const cases: readonly (readonly [rule: string, red: string, refusal: string, green: string])[] = [
    ["em dash", "It builds — and ships.", "1: carries `—`, an em dash. End the sentence, or use a comma", "It builds, and ships."],
    ["en dash", "Pages 1–5 hold it.", "1: carries `–`, an en dash. End the sentence, or use a comma", "Pages 1 to 5 hold it."],
    [
      "parenthesis",
      "It builds (fast).",
      "1: carries `(`, a parenthesis other than the plural `(s)`. Make the aside its own sentence, or set it off with commas",
      "It builds, fast.",
    ],
    ["spaced hyphen", "It builds - and ships.", "1: carries `-`, a hyphen used as a dash. End the sentence, or use a comma", "It builds and ships."],
    ["double hyphen", "It builds -- and ships.", "1: carries `--`, a hyphen used as a dash. End the sentence, or use a comma", "It builds and ships."],
    ["semicolon", "It builds; it ships.", "1: carries `;`, a semicolon. Use two sentences", "It builds and ships."],
    [
      "future promise",
      "Windows support is planned.",
      "1: carries `is planned`, a promise about the future. Say what is true now",
      "Windows is not supported.",
    ],
    [
      "promise on an issue",
      "It stays manual until #11 lands.",
      "1: carries `until #11`, a promise about the future. Say what is true now",
      "It stays manual.",
    ],
    [
      "self-reference",
      "This page explains the gate.",
      "1: carries `This page explains`, a sentence that opens by talking about the page. Talk directly about the subject",
      "The gate refuses a banned comment.",
    ],
    [
      "second sentence",
      "It builds. It ships.",
      "1: carries a second sentence on one line, which opens with `It ships`. Start it on its own line",
      "It builds.\nIt ships.",
    ],
  ];

  for (const [rule, red, refusal, green] of cases) {
    test(rule, () => {
      expect(refusals(red)).toEqual([refusal]);
      expect(refusals(green)).toEqual([]);
    });
  }

  test("a sentence wrapped across lines, on each line it spans", () => {
    const wrapped = "It builds the bill and\nships it to the supplier.\n";
    const runOn = "carries a sentence that runs across lines. Join the sentence onto one line";
    expect(refusals(wrapped)).toEqual([`1: ${runOn}`, `2: ${runOn}`]);
    expect(refusals("It builds the bill and ships it to the supplier.\n")).toEqual([]);
  });
});

describe("what a reader does not read as prose passes", () => {
  test("fenced code, inline code, link destinations, URLs, HTML comments and entities", () => {
    const text = [
      "```sh",
      "a; b — c (d) - e",
      "```",
      "Run `a; b (c) - d` to see [the page](docs/a(b).md).",
      "It lives at https://example.com/a-(b)?c=d;e and <https://example.com/x;y>.",
      "<!-- generated block; bun run build (writes it) -->",
      "It builds&nbsp;fast.",
      "~~~",
      "It builds. It ships (twice); fast — slow",
      "~~~",
    ].join("\n");
    expect(refusals(text)).toEqual([]);
  });

  test("a plural (s), a dash as a table cell, list markers and a hyphenated word", () => {
    const text = ["Each file(s) is read.", "", "| Code | When |", "| --- | --- |", "| 0 | - |", "", "- A first item", "- A well-known second item"].join("\n");
    expect(refusals(text)).toEqual([]);
  });

  test("a bold label that opens a line heads its sentence, and a second sentence after it still counts", () => {
  expect(refusals("**Status.** Tested by `tests/x.test.ts`.\n- __Reclaim.__ On tmux it refuses.")).toEqual([]);
  expect(refusals("**Status.** Tested by `x`. It ships.")).toEqual([
    "1: carries a second sentence on one line, which opens with `It ships`. Start it on its own line",
  ]);
});

test("an abbreviation before a capital, and a self-reference that does not open the sentence", () => {
    expect(refusals("It reads the lockfile, e.g. Bun writes one.\nRead the guide this page names.")).toEqual([]);
  });

  test("a multi-line HTML block, and a line whose sentence may end in its closing code", () => {
    const text = ['<a href="x">', "  <img", '      alt="Logo"', '      src="logo.svg"', "  /></a>", "", "Prompt: `List every tool.`", "Each variant ran alone."].join("\n");
    expect(refusals(text)).toEqual([]);
  });

  test("front matter", () => {
    expect(refusals("---\ntitle: a; b\n---\n# Title\n")).toEqual([]);
  });
});

test("each example the checks-docs page shows is refused by its own rule", () => {
  const unrefused = PROSE_RULES.flatMap(({ refuses, example }) => {
    const spans = [...example.matchAll(/`([^`]+)`/g)].map(([, span = ""]) => span);
    const texts = refuses.includes("runs across lines") ? [spans.join("\n")] : spans;
    return texts.filter((text) => !proseFindings(text, "people").some(({ message }) => message.includes(refuses))).map((text) => `${refuses}: ${text}`);
  });
  expect(unrefused).toEqual([]);
});

test("only the lines a change adds or edits are judged", () => {
  const text = "It builds; it ships.\nIt reads; it writes.\n";
  expect(refusals(text, new Set([2]))).toEqual(["2: carries `;`, a semicolon. Use two sentences"]);
  expect(refusals(text, new Set())).toEqual([]);
});

test("masking keeps each line's length, so a column in the prose is the column in the raw line", () => {
  const [line] = scanMarkdown("🎉 run `x` and [y](z.md); fine");
  expect(line?.prose.length).toBe(line?.raw.length);
  expect(line?.code).toEqual(["x"]);
  expect(line?.links).toEqual(["z.md"]);
});

test("living docs are READMEs, CONTRIBUTING.md and pages under docs/, but not records or agent files", () => {
  const living = ["README.md", "home/.config/mise/README.md", "CONTRIBUTING.md", ".github/CONTRIBUTING.md", "docs/design.md", "docs/gates/checks-docs.md"];
  const exempt = [
    "docs/adr/0001-quality-gates.md",
    "docs/adr/README.md",
    "docs/probes/0001-a-probe.md",
    "docs/plans/2026-05-08-a-plan.md",
    "CHANGELOG.md",
    "AGENTS.md",
    "CLAUDE.md",
    "docs/AGENTS.md",
    "notes.md",
    "docs/diagram.png",
  ];
  expect(living.filter((path) => !isLivingDoc(path))).toEqual([]);
  expect(exempt.filter(isLivingDoc)).toEqual([]);
});

test("the host entry names each refusal by path and line, and refuses nothing in a doc that is not living", () => {
  expect(proseRefused("docs/guide.md", "It builds; it ships.\n")).toEqual(["docs/guide.md:1 carries `;`, a semicolon. Use two sentences"]);
  expect(proseRefused("docs/adr/0001-a-record.md", "It builds; it ships.\n")).toEqual([]);
});

test("an agent file takes the separator rules and no other, and a changelog takes none", () => {
  expect(["AGENTS.md", "CLAUDE.md", "tools/AGENTS.md"].map(readerOf)).toEqual(["agents", "agents", "agents"]);
  expect(["CHANGELOG.md", "docs/adr/0001-a-record.md"].map(readerOf)).toEqual([undefined, undefined]);
  const separators = PROSE_RULES.filter(({ readers }) => readers.includes("agents")).map(({ refuses }) => refuses);
  expect(separators).toEqual(["an em dash", "an en dash", "a parenthesis other than the plural `(s)`", "a hyphen used as a dash", "a semicolon"]);

  const text = "It builds — fast; it ships (twice) - once.\nIt builds. It ships.\nThis page explains it, and support is planned\nand ships.\n";
  expect(proseRefused("AGENTS.md", text).map((refusal) => refusal.split(",")[0])).toEqual([
    "AGENTS.md:1 carries `—`",
    "AGENTS.md:1 carries `(`",
    "AGENTS.md:1 carries `-`",
    "AGENTS.md:1 carries `;`",
  ]);
  expect(proseRefused("CHANGELOG.md", text)).toEqual([]);
});
