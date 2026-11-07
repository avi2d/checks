import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { docsRepos, type DocsRepo } from "../lib/docs-repo.ts";
import { CHECKOUT } from "../lib/fixture-repo.ts";

const repository = docsRepos();

function initRepo(): Promise<DocsRepo> {
  return repository();
}

function fixtureReadme(): Promise<string> {
  return readFile(join(CHECKOUT, "tests", "fixtures", "docs", "readme.md"), "utf8");
}

const LARGEST = "## Build a bill of materials";

function grownTo(readme: string, size: number): string {
  const [before = "", after = ""] = readme.split("## Where things are");
  const filler = "Each part names its supplier.\n".repeat(Math.floor((size - readme.length) / 40));
  const room = size - readme.length - filler.length - 2;
  return `${before}${filler}${"x".repeat(room)}\n\n## Where things are${after}`;
}

const OVER = "  README.md: is 6001 characters, over the 6,000-character ceiling for a README. Its largest section is `## Build a bill of materials`";

test(
  "a README of 6,001 characters fails the range that edits it, naming its largest section, and passes once that section shrinks",
  async () => {
    const { put, commit, docs } = await initRepo();
    const readme = await fixtureReadme();
    await put("README.md", readme);
    const previous = await commit("a README that fits");
    const grown = grownTo(readme, 6001);
    expect(grown.length).toBe(6001);
    await put("README.md", grown);
    const planted = await commit("grow the README past the ceiling");

    const red = await docs(previous, planted);
    expect(red.text).toContain(OVER);
    expect(red.text).toContain(LARGEST);
    expect(red.text).toContain("Move that section to a page under docs/");
    expect(red.exitCode).toBe(1);

    await put("README.md", readme);
    const fixed = await commit("move the section out");
    const green = await docs(planted, fixed);
    expect(green.text).toContain("docs: the 1 README(s) the range edits hold to the 6,000-character ceiling and the 300-character table cell ceiling");
    expect(green.exitCode).toBe(0);
  },
  120_000,
);

test(
  "an oversize README the range leaves alone is advisory and does not fail a range that edits another file",
  async () => {
    const { put, commit, docs } = await initRepo();
    await put("README.md", grownTo(await fixtureReadme(), 6001));
    const previous = await commit("an oversize README before the range");
    await put("notes.md", "anything\n");
    const head = await commit("touch only another file");

    const quiet = await docs(previous, head);
    expect(quiet.text).toContain("docs: advisory, 1 README ceiling finding(s) in README(s) the range leaves alone:");
    expect(quiet.text).toContain(OVER);
    expect(quiet.exitCode).toBe(0);
  },
  120_000,
);

test(
  "a 301-character cell fails in a README beside a package.json the range edits, and never in a README with no package.json beside it",
  async () => {
    const { put, commit, docs } = await initRepo();
    const previous = await commit("start");
    const table = `# Run\n\nIt runs.\n\n| Part | What it holds |\n| --- | --- |\n| run | ${"y".repeat(301)} |\n`;
    await put("packages/run/package.json", "{}\n");
    await put("packages/run/README.md", table);
    await put("notes/README.md", table);
    const planted = await commit("a long cell in two nested READMEs");

    const red = await docs(previous, planted);
    expect(red.text).toContain("  packages/run/README.md:7: holds a 301-character table cell, over the 300-character ceiling for a README table cell");
    expect(red.text).not.toContain("notes/README.md:7: holds");
    expect(red.exitCode).toBe(1);
  },
  120_000,
);
