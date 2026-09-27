import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Kind } from "../../src/docs/doc-templates.ts";
import { docsRepos, type DocsRepo } from "./lib/docs-repo.ts";
import { CHECKOUT } from "./lib/fixture-repo.ts";

const FIXTURES = join(CHECKOUT, "tests", "fixtures", "docs");

type Plant = {
  readonly kind: Kind;
  readonly path: string;
  readonly defect: (text: string) => string;
  readonly refusal: string;
};

const PLANTS: readonly Plant[] = [
  {
    kind: "readme",
    path: "README.md",
    defect: (text) => text.replace("## Where things are", "## Layout"),
    refusal: "README.md:1: lacks `## Where things are`",
  },
  {
    kind: "changelog",
    path: "CHANGELOG.md",
    defect: (text) => text.replace("## 1.0.0", "## 1.2.0"),
    refusal: "CHANGELOG.md:17: `## 1.2.0` follows `## 1.1.0`, and releases run newest first",
  },
  {
    kind: "adr",
    path: "docs/adr/0001-a-part-names-its-supplier.md",
    defect: (text) => text.replace("Accepted.", "Maybe."),
    refusal: "docs/adr/0001-a-part-names-its-supplier.md:7: `## Status` opens with `Maybe`",
  },
  {
    kind: "agents",
    path: "AGENTS.md",
    defect: (text) => text.replace("## Maintaining this file", "## Maintenance"),
    refusal: "AGENTS.md:1: lacks `## Maintaining this file`",
  },
  {
    kind: "claude",
    path: "CLAUDE.md",
    defect: (text) => `${text}Also read README.md.\n`,
    refusal: "CLAUDE.md:3: differs from dist/templates/claude.md, which it holds word for word",
  },
  {
    kind: "tutorial",
    path: "docs/first-bill.md",
    defect: (text) => text.replace("## Before you begin", "## What you need"),
    refusal: "docs/first-bill.md:4: lacks `## Before you begin`",
  },
  {
    kind: "how-to",
    path: "docs/add-a-supplier.md",
    defect: (text) => text.replace(/^1\. /gm, "- "),
    refusal: "docs/add-a-supplier.md:4: numbers no steps, which a how-to page lists as `1.` items",
  },
  {
    kind: "reference",
    path: "docs/parts.md",
    defect: (text) => text.replace("## Fields", "#### Fields"),
    refusal: "docs/parts.md:8: `#### Fields` skips a level under `# The parts format`",
  },
  {
    kind: "explanation",
    path: "docs/suppliers.md",
    defect: (text) => text.replace("# Suppliers on parts\n", "Suppliers on parts\n"),
    refusal: "docs/suppliers.md:4: does not open with a `# ` title on its first line",
  },
];

const repository = docsRepos();

function initRepo(): Promise<DocsRepo> {
  return repository();
}

function fixture(kind: Kind): Promise<string> {
  return readFile(join(FIXTURES, `${kind}.md`), "utf8");
}

function page(kind: Kind, path: string, text: string): string {
  return path.startsWith("docs/") && !path.startsWith("docs/adr/") ? `---\nkind: ${kind}\n---\n${text}` : text;
}

test(
  "a planted non-conforming file of each kind goes red, and green once it holds to its template",
  async () => {
    const { put, commit, docs } = await initRepo();
    let previous = await commit("start");
    for (const { kind, path, defect, refusal } of PLANTS) {
      const conforming = await fixture(kind);
      await put(path, page(kind, path, defect(conforming)));
      const planted = await commit(`plant a ${kind} that breaks its template`);
      const red = await docs(previous, planted);
      expect(red.text).toContain(`  ${refusal}`);
      expect(red.exitCode).toBe(1);

      await put(path, page(kind, path, conforming));
      const fixed = await commit(`bring the ${kind} to its template`);
      const green = await docs(planted, fixed);
      expect(green.text).toContain("docs: 1 doc file(s) the range touches hold to their templates");
      expect(green.exitCode).toBe(0);
      previous = fixed;
    }
  },
  120_000,
);

test(
  "a file the range leaves alone is advisory, and the range that touches it is held to the template",
  async () => {
    const { put, commit, docs } = await initRepo();
    await put("README.md", "# widget\n\nIt builds bills.\n");
    const base = await commit("a README before the template");
    await put("notes.md", "anything\n");
    const unrelated = await commit("an unrelated Markdown file");

    const quiet = await docs(base, unrelated);
    expect(quiet.text).toContain("docs: 0 doc file(s) the range touches hold to their templates");
    expect(quiet.text).toContain("docs: advisory, 1 doc file(s) the range leaves alone do not hold to their templates yet:\n  README.md: 4 violation(s)");
    expect(quiet.exitCode).toBe(0);

    await put("README.md", "# widget\n\nIt builds bills, fast.\n");
    const touched = await commit("touch the README");
    const held = await docs(touched);
    expect(held.text).toContain("docs: 4 violation(s):\n  README.md:1: lacks `## Before you begin`");
    expect(held.exitCode).toBe(1);
  },
  120_000,
);

test(
  "a page under docs/ needs a mode at the page, and a record may not take a number another holds",
  async () => {
    const { put, remove, commit, docs } = await initRepo();
    await put("docs/adr/0001-a-part-names-its-supplier.md", await fixture("adr"));
    const base = await commit("one record");
    await put("docs/parts.md", await fixture("reference"));
    await put("docs/adr/0001-a-second-record.md", (await fixture("adr")).replace("A part names", "A record reuses"));
    const head = await commit("an undeclared page and a record with a taken number");

    const red = await docs(base, head);
    expect(red.text).toContain("  docs/adr/0001-a-second-record.md:1: shares number 1 with docs/adr/0001-a-part-names-its-supplier.md\n");
    expect(red.text).toContain("  docs/parts.md: is a page under docs/ with no mode; add kind:");
    expect(red.exitCode).toBe(1);

    await put("docs/parts.md", page("reference", "docs/parts.md", await fixture("reference")));
    await remove("docs/adr/0001-a-second-record.md");
    const fixed = await commit("declare the page and drop the second record");
    const green = await docs(base, fixed);
    expect(green.text).toContain("docs: 1 doc file(s) the range touches hold to their templates");
    expect(green.exitCode).toBe(0);
  },
  120_000,
);

test(
  "an unknown page kind does not silently skip the template",
  async () => {
    const { put, commit, docs } = await initRepo();
    await put("docs/guide.md", `---\nkind: guide\n---\n${await fixture("reference")}`);
    const head = await commit("an unknown mode");
    const red = await docs(head);
    expect(red.text).toContain("docs/guide.md: is a page under docs/ with no mode");
    expect(red.exitCode).toBe(1);
  },
  120_000,
);
