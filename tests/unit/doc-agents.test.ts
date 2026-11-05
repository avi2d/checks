import { expect, test } from "bun:test";
import {
  AGENT_CEILING,
  CELL_CEILING,
  README_CEILING,
  ceilingFinding,
  entries,
  entryFindings,
  isAgentFile,
  isCeiledReadme,
  maintainingFinding,
  readmeFindings,
  type AgentFinding,
} from "../../src/docs/doc-agents.ts";
import { snapshotOf } from "../../src/docs/doc-references.ts";

const LEAD = "# Project agent memory\n\nchecks judges a repository through gates, and `README.md` holds what a person reads.\n";

test("an agent file is recognised by name in any directory", () => {
  expect(["AGENTS.md", "CLAUDE.md", "tools/AGENTS.md"].map(isAgentFile)).toEqual([true, true, true]);
  expect(["agents.md", "README.md", "docs/guide.md"].map(isAgentFile)).toEqual([false, false, false]);
});

test("the ceiling holds at 3,000 characters and fails above it with the fix", () => {
  expect(ceilingFinding("x".repeat(AGENT_CEILING))).toBeUndefined();
  expect(AGENT_CEILING).toBe(3000);
  const over = ceilingFinding("x".repeat(AGENT_CEILING + 1));
  expect(over?.line).toBeUndefined();
  expect(over?.message).toContain("is 3001 characters, over the 3,000-character ceiling for agent files");
  expect(over?.message).toContain("move each part's notes into the people doc that covers that part");
});

test("a README of 6,001 characters fails the ceiling and one of 6,000 never does", () => {
  expect(README_CEILING).toBe(6000);
  expect(readmeFindings("x".repeat(6000))).toEqual([]);
  const [over, ...rest] = readmeFindings("x".repeat(6001));
  expect(rest).toEqual([]);
  expect(over?.line).toBeUndefined();
  expect(over?.message).toContain("is 6001 characters, over the 6,000-character ceiling for a README");
  expect(over?.message).toContain("Move that section to a page under docs/");
});

test("the README ceiling names the largest section rather than the first or the last", () => {
  const text = `# widget\n\nIt builds bills.\n\n## Install\n\n${"a".repeat(1000)}\n\n## Build a bill\n\n${"b".repeat(4000)}\n\n## Where things are\n\n${"c".repeat(1000)}\n`;
  const [over] = readmeFindings(text);
  expect(over?.message).toContain(`is ${text.length} characters`);
  expect(over?.message).toContain("Its largest section is `## Build a bill` at 4019 characters");
});

test("lines in a generated block do not count toward the README ceiling, and a hand-written 6,001 still fails beside one", () => {
  const block = `<!-- generated index: bun run build writes it -->\n${"| a | b |\n".repeat(2000)}<!-- end generated index -->\n`;
  expect(readmeFindings(`${block}${"x".repeat(5999)}`)).toEqual([]);
  expect(readmeFindings(`${block}${"x".repeat(6001)}`)[0]?.message).toContain("is 6001 characters");
});

test("a table cell of 301 characters fails and one of 300 never does", () => {
  expect(CELL_CEILING).toBe(300);
  const table = (cell: string): string => `# widget\n\n| Path | What it holds |\n| --- | --- |\n| \`src/\` | ${cell} |\n`;
  expect(readmeFindings(table("y".repeat(300)))).toEqual([]);
  expect(readmeFindings(table("y".repeat(301)))).toEqual([
    {
      line: 5,
      message: "holds a 301-character table cell, over the 300-character ceiling for a README table cell. Move the detail to a page under docs/ and keep the cell to what a reader scans",
    },
  ]);
});

test("a long table cell inside a generated block does not fail", () => {
  const text = `# widget\n\n<!-- generated parts: bun run build writes it -->\n| Part | Note |\n| --- | --- |\n| bolt | ${"y".repeat(900)} |\n<!-- end generated parts -->\n`;
  expect(readmeFindings(text)).toEqual([]);
});

test("a long cell in a fenced code block is not a table cell", () => {
  expect(readmeFindings(`# widget\n\n\`\`\`md\n| ${"y".repeat(400)} |\n\`\`\`\n`)).toEqual([]);
});

test("the README ceilings cover the root README and a README beside a package.json, and no other README", () => {
  const files = new Set(["package.json", "packages/run/package.json", "packages/run/README.md", "docs/README.md", "README.md"]);
  expect(["README.md", "packages/run/README.md"].map((path) => isCeiledReadme(path, files))).toEqual([true, true]);
  expect(["docs/README.md", "packages/README.md", "packages/run/CONTRIBUTING.md"].map((path) => isCeiledReadme(path, files))).toEqual([false, false, false]);
});

const TRACKED = snapshotOf(["src/parts.toml", "docs/layout.md", "CONTRIBUTING.md", "LICENSE", ".gitignore", "tools/build.ts"], new Map(), new Map());
const KEEP = "\n## Maintaining this file\n\nKeep this file for knowledge useful to almost every future agent session in this project.\n";
const NAMES_NOTHING = "names no tracked path, link or `bun run` command. Name the file, link or command that holds the detail";

function findingsFor(entry: string, agentFile = "AGENTS.md"): readonly AgentFinding[] {
  return entryFindings(agentFile, `${LEAD}\n## Parts\n\n${entry}\n`, TRACKED);
}

function entryLines(text: string): readonly number[] {
  return entries(text).map(({ line }) => line);
}

test("entries are every visible list item, the lead and a Maintaining section included, and never fenced code", () => {
  const text = `${LEAD}\n- a lead bullet\n\n## Parts\n\n- a topic bullet\n\n### Detail\n\n1. a numbered bullet\n\n\`\`\`md\n- a fenced bullet\n\`\`\`${KEEP}\n- a maintaining bullet\n`;
  expect(entryLines(text)).toEqual([5, 9, 13, 22]);
});

test("a list in front matter is not an entry", () => {
  expect(entryLines(`---\ntags:\n  - agents\n---\n${LEAD}\n- a lead bullet\n`)).toEqual([9]);
});

test("a line in an indented code block is not an entry, and a nested item is", () => {
  const text = `${LEAD}\n## Parts\n\nA paragraph.\n\n    - an indented code line\n    - another\n\n- an entry\n    - a nested entry\n\n    - a later paragraph of the entry\n`;
  expect(entryLines(text)).toEqual([12, 13, 15]);
});

test("an indented code line inside a blockquote is not an entry, and a quoted list item is", () => {
  const text = `${LEAD}\n## Parts\n\n> A quoted paragraph.\n>\n>     - an indented code line in a quote\n>\n> - a quoted entry\n`;
  expect(entryLines(text)).toEqual([11]);
});

test("a list item right after an HTML block that closes on its own line is an entry", () => {
  const text = `${LEAD}\n## Parts\n\n<script>\n- a scripted line\n</script>\n- a visible entry\n`;
  expect(entryLines(text)).toEqual([10]);
  expect(entryFindings("AGENTS.md", text, TRACKED)).toEqual([{ line: 10, message: NAMES_NOTHING }]);
});

test("a fence inside a closed HTML block leaves the entry after it readable", () => {
  const text = `${LEAD}\n## Parts\n\n<pre>\n\`\`\`\n</pre>\n- Read \`LICENSE\` first.\n`;
  expect(entryLines(text)).toEqual([10]);
  expect(entryFindings("AGENTS.md", text, TRACKED)).toEqual([]);
});

test("an unmatched comment opener inside a script block leaves the entry after it readable", () => {
  const text = `${LEAD}\n## Parts\n\n<script>\nconst open = "<!--";\n</script>\n- Read \`LICENSE\` first.\n`;
  expect(entryLines(text)).toEqual([10]);
  expect(entryFindings("AGENTS.md", text, TRACKED)).toEqual([]);
});

test("a visible Maintaining this file section fails, and a commented one or none does not", () => {
  expect(maintainingFinding(`${LEAD}\n## Parts\n\n- edit \`src/parts.toml\`\n${KEEP}`)).toEqual({
    line: 9,
    message: "holds `## Maintaining this file`, which a router leaves out. Delete the section, since checks-docs holds the file's shape",
  });
  expect(maintainingFinding(`${LEAD}\n<!-- ## Maintaining this file -->\n`)).toBeUndefined();
  expect(maintainingFinding(`${LEAD}\n<!--\n\n## Maintaining this file\n\n-->\n`)).toBeUndefined();
  expect(maintainingFinding(`${LEAD}\n## Parts\n\n- edit \`src/parts.toml\`\n`)).toBeUndefined();
});

test("a list item inside an HTML comment or an HTML block is not an entry", () => {
  const text = `${LEAD}\n## Parts\n\n<!-- - an old entry -->\n<!--\n- a commented entry\n-->\n\n<details>\n- an entry in a block\n</details>\n\n- a visible entry\n`;
  expect(entryLines(text)).toEqual([16]);
  expect(entryFindings("AGENTS.md", text, TRACKED)).toEqual([{ line: 16, message: NAMES_NOTHING }]);
});

test("an entry passes when it names a tracked path, a link with a destination or a bun run command", () => {
  const passing = [
    "- edit `src/parts.toml` instead",
    "- read `CONTRIBUTING.md` first",
    "- read `LICENSE` first",
    "- keep `.gitignore` in step",
    "- look under `docs/` first",
    "- look under `docs/.` first",
    "- read [the layout](docs/layout.md) first",
    "- read [the `layout`](<docs/layout.md>) first",
    "- read [the guide](https://example.com/guide) first",
    "- run `bun run parts` first",
  ];
  expect(passing.map((entry) => findingsFor(entry))).toEqual(passing.map(() => []));
});

test("an entry fails when it names no tracked path, no link and no command", () => {
  const failing = [
    "- write good code",
    "- edit `src/missing.toml` instead",
    "- read `MISSING.md` first",
    "- read `LICENSE/` first",
    "- read `LICENSE/.` first",
    "- read `LICENSE/../LICENSE` first",
    "- read `.` first",
    "- read [the guide](docs/layout.md first",
    "- read `docs/layout.md/` first",
    "- read [the guide]() first",
    "- read guide](docs/layout.md) first",
    "- see ![the diagram](docs/layout.md) first",
    "- read `[the guide](docs/layout.md)` first",
    "- read <!-- [the guide](docs/layout.md) --> first",
    "- use `strict` mode",
  ];
  expect(failing.map((entry) => findingsFor(entry))).toEqual(failing.map(() => [{ line: 7, message: NAMES_NOTHING }]));
});

test("a nested agent file names a path from its own directory, its parent or the root", () => {
  const passing = [
    "- edit `build.ts` first",
    "- edit `./build.ts` first",
    "- edit `tools/build.ts` first",
    "- read `../docs/layout.md` first",
    "- read `./../LICENSE` first",
    "- look under `./` first",
    "- look under `../tools/` first",
  ];
  expect(passing.map((entry) => findingsFor(entry, "tools/AGENTS.md"))).toEqual(passing.map(() => []));
  const failing = ["- edit `build.ts` first", "- read `../LICENSE` first", "- edit `./tools/../../build.ts` first"];
  expect(failing.map((entry) => findingsFor(entry))).toEqual(failing.map(() => [{ line: 7, message: NAMES_NOTHING }]));
  const pointerless = ["- Keep a ` ` between words.", "- see `/` first", "- see `//` first"];
  expect(pointerless.map((entry) => findingsFor(entry, "tools/AGENTS.md"))).toEqual(pointerless.map(() => [{ line: 7, message: NAMES_NOTHING }]));
});

test("an entry fails wherever it sits and whatever the range touches, the lead included", () => {
  const text = `${LEAD}\n- write good code\n\n## Parts\n\n- edit \`src/parts.toml\` instead\n${KEEP}\n- a maintaining bullet\n`;
  expect(entryFindings("AGENTS.md", text, TRACKED)).toEqual([
    { line: 5, message: NAMES_NOTHING },
    { line: 15, message: NAMES_NOTHING },
  ]);
});
