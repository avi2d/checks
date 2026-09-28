import { expect, test } from "bun:test";
import { AGENT_CEILING, ceilingFinding, entryFindings, entryLines, isAgentFile, type AgentFinding } from "../../src/docs/doc-agents.ts";

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

const TRACKED = new Set(["src/parts.toml", "src", "docs/layout.md", "docs", "CONTRIBUTING.md", "LICENSE", ".gitignore", "tools/build.ts", "tools"]);
const isTracked = (path: string): boolean => TRACKED.has(path);
const NAMES_NOTHING = "names no tracked path, link or `bun run` command. Name the file, link or command that holds the detail";

function findingsFor(entry: string, agentFile = "AGENTS.md"): readonly AgentFinding[] {
  return entryFindings(agentFile, `${LEAD}\n## Parts\n\n${entry}\n`, isTracked);
}

test("entries are every list item but the Maintaining section and fenced code, the lead included", () => {
  const text = `${LEAD}\n- a lead bullet\n\n## Parts\n\n- a topic bullet\n\n### Detail\n\n1. a numbered bullet\n\n\`\`\`md\n- a fenced bullet\n\`\`\`${KEEP}\n- a maintaining bullet\n`;
  expect(entryLines(text)).toEqual([5, 9, 13]);
});

test("an entry passes when it names a tracked path, a link with a destination or a bun run command", () => {
  const entries = [
    "- edit `src/parts.toml` instead",
    "- read `CONTRIBUTING.md` first",
    "- read `LICENSE` first",
    "- keep `.gitignore` in step",
    "- look under `docs/` first",
    "- read [the layout](docs/layout.md) first",
    "- read [the guide](https://example.com/guide) first",
    "- run `bun run parts` first",
  ];
  expect(entries.map((entry) => findingsFor(entry))).toEqual(entries.map(() => []));
});

test("an entry fails when it names no tracked path, no link destination and no command", () => {
  const entries = ["- write good code", "- edit `src/missing.toml` instead", "- read `MISSING.md` first", "- read [the guide]() first", "- use `strict` mode"];
  expect(entries.map((entry) => findingsFor(entry))).toEqual(entries.map(() => [{ line: 7, message: NAMES_NOTHING }]));
});

test("a nested agent file names a path from its own directory or from the root", () => {
  expect(findingsFor("- edit `build.ts` first", "tools/AGENTS.md")).toEqual([]);
  expect(findingsFor("- edit `tools/build.ts` first", "tools/AGENTS.md")).toEqual([]);
  expect(findingsFor("- edit `build.ts` first")).toEqual([{ line: 7, message: NAMES_NOTHING }]);
});

test("an entry fails wherever it sits and whatever the range touches, the lead included", () => {
  const text = `${LEAD}\n- write good code\n\n## Parts\n\n- edit \`src/parts.toml\` instead\n${KEEP}\n- a maintaining bullet\n`;
  expect(entryFindings("AGENTS.md", text, isTracked)).toEqual([{ line: 5, message: NAMES_NOTHING }]);
});
