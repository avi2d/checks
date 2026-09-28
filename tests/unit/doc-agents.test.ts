import { expect, test } from "bun:test";
import { AGENT_CEILING, ceilingFinding, entryFindings, isAgentFile, topicBullets } from "../../src/docs/doc-agents.ts";

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

test("topic bullets skip the lead, the Maintaining section and fenced code", () => {
  const text = `${LEAD}\n- a lead bullet\n\n## Parts\n\n- a topic bullet\n\n### Detail\n\n1. a numbered bullet\n\n\`\`\`md\n- a fenced bullet\n\`\`\`${KEEP}\n- a maintaining bullet\n`;
  expect(topicBullets(text)).toEqual([9, 13]);
});

test("an entry passes when it names a path, a link or a command", () => {
  const text = `${LEAD}\n## Parts\n\n- edit \`src/parts.toml\` instead\n- read [the layout](docs/layout.md) first\n- run \`bun run parts\` first\n`;
  expect(entryFindings(text, new Set([7, 8, 9]), true)).toEqual([]);
});

test("an entry that names nothing fails on a line the range adds, and passes elsewhere", () => {
  const text = `${LEAD}\n## Parts\n\n- write good code\n`;
  expect(entryFindings(text, new Set([7]), true)).toEqual([
    {
      line: 7,
      message: "names no path, link or command that resolves. Name the file, link or command that holds the detail",
    },
  ]);
  expect(entryFindings(text, new Set([2]), true)).toEqual([]);
});

test("a command counts only when the page judges commands", () => {
  const text = `${LEAD}\n## Parts\n\n- run \`bun run parts\` first\n`;
  expect(entryFindings(text, new Set([7]), false)).toEqual([
    {
      line: 7,
      message: "names no path, link or command that resolves. Name the file, link or command that holds the detail",
    },
  ]);
});
