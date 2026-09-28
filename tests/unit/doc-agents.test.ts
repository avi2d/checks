import { expect, test } from "bun:test";
import { AGENT_CEILING, ceilingFinding, entryFindings, entryLines, isAgentFile, type AgentFinding } from "../../src/docs/doc-agents.ts";
import { snapshotOf } from "../../src/docs/doc-references.ts";

const LEAD = "# Project agent memory\n\nchecks judges a repository through gates, and `README.md` holds what a person reads.\n";
const KEEP = "\n## Maintaining this file\n\nKeep this file for knowledge useful to almost every future agent session in this project.\n";

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

const SNAPSHOT = snapshotOf(
  ["src/parts.toml", "docs/layout.md", "CONTRIBUTING.md", "package.json"],
  new Map([["docs/layout.md", new Set(["parts"])]]),
  new Map([["", new Set(["parts"])]]),
);
const NAMES_NOTHING = "names no path, link or command that resolves. Name the file, link or command that holds the detail";

function findingsFor(entry: string, commands = true): readonly AgentFinding[] {
  return entryFindings("AGENTS.md", `${LEAD}\n## Parts\n\n${entry}\n`, SNAPSHOT, { commands });
}

test("entries are every list item but the Maintaining section and fenced code, the lead included", () => {
  const text = `${LEAD}\n- a lead bullet\n\n## Parts\n\n- a topic bullet\n\n### Detail\n\n1. a numbered bullet\n\n\`\`\`md\n- a fenced bullet\n\`\`\`${KEEP}\n- a maintaining bullet\n`;
  expect(entryLines(text)).toEqual([5, 9, 13]);
});

test("an entry passes when it names a path, a root-level file, a link or a command that resolves", () => {
  const entries = [
    "- edit `src/parts.toml` instead",
    "- read `CONTRIBUTING.md` first",
    "- read [the layout](docs/layout.md) first",
    "- read [the parts](docs/layout.md#parts) first",
    "- run `bun run parts` first",
  ];
  expect(entries.map((entry) => findingsFor(entry))).toEqual(entries.map(() => []));
});

test("an entry fails when nothing it names resolves", () => {
  const entries = [
    "- write good code",
    "- edit `src/missing.toml` instead",
    "- read `MISSING.md` first",
    "- read [the guide]() first",
    "- read [the guide](docs/missing.md) first",
    "- read [the guide](docs/layout.md#missing) first",
    "- read [the guide](https://example.com/guide) first",
    "- run `bun run missing` first",
  ];
  expect(entries.map((entry) => findingsFor(entry))).toEqual(entries.map(() => [{ line: 7, message: NAMES_NOTHING }]));
});

test("an entry fails wherever it sits and whatever the range touches, the lead included", () => {
  const text = `${LEAD}\n- write good code\n\n## Parts\n\n- edit \`src/parts.toml\` instead\n${KEEP}\n- a maintaining bullet\n`;
  expect(entryFindings("AGENTS.md", text, SNAPSHOT, { commands: true })).toEqual([{ line: 5, message: NAMES_NOTHING }]);
});

test("a command counts only when the page judges commands", () => {
  expect(findingsFor("- run `bun run parts` first", false)).toEqual([{ line: 7, message: NAMES_NOTHING }]);
});
