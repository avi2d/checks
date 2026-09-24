import { $ } from "bun";
import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { Kind } from "../../scripts/doc-templates.ts";

const CHECKOUT = resolve(import.meta.dir, "..", "..");
const SCRIPT = join(CHECKOUT, "scripts", "docs.ts");
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
    refusal: "README.md:27: `## Layout` opens with `Layout`, which is not on the kit's list of imperative verbs",
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
    refusal: "CLAUDE.md:3: differs from templates/claude.md, which it holds word for word",
  },
  {
    kind: "tutorial",
    path: "docs/first-bill.md",
    defect: (text) => text.replace("## Before you begin", "## What you need"),
    refusal: "docs/first-bill.md:5: `## What you need` opens with `What`, which is not on the kit's list of imperative verbs",
  },
  {
    kind: "how-to",
    path: "docs/add-a-supplier.md",
    defect: (text) => text.replace(/^1\. /gm, "- "),
    refusal: "docs/add-a-supplier.md:1: numbers no steps, which a how-to page lists as `1.` items",
  },
  {
    kind: "reference",
    path: "docs/parts.md",
    defect: (text) => text.replace("## Fields", "#### Fields"),
    refusal: "docs/parts.md:5: `#### Fields` skips a level under `# The parts format`",
  },
  {
    kind: "explanation",
    path: "docs/suppliers.md",
    defect: (text) => text.replace("# Suppliers on parts\n", "Suppliers on parts\n"),
    refusal: "docs/suppliers.md:1: does not open with a `# ` title on its first line",
  },
];

const QUALITY = {
  docs: {
    pages: {
      tutorial: ["docs/first-bill.md"],
      "how-to": ["docs/add-a-supplier.md"],
      reference: ["docs/parts.md"],
      explanation: ["docs/suppliers.md"],
    },
  },
};

let dir = "";

afterEach(async () => {
  if (dir !== "") {
    await rm(dir, { recursive: true, force: true });
    dir = "";
  }
});

async function initRepo(quality: unknown): Promise<void> {
  dir = await mkdtemp(join(tmpdir(), "checks-docs-"));
  await $`git init -q -b main`.cwd(dir).quiet();
  await $`git config user.name tester && git config user.email tester@example.com`.cwd(dir).quiet();
  await writeFile(join(dir, "quality.json"), JSON.stringify(quality));
  await writeFile(join(dir, "widget.ts"), "export const widget = 1;\n");
}

async function put(path: string, text: string): Promise<void> {
  await mkdir(dirname(join(dir, path)), { recursive: true });
  await writeFile(join(dir, path), text);
}

async function commit(message: string): Promise<string> {
  await $`git add -A && git commit -q --no-gpg-sign -m ${message}`.cwd(dir).quiet();
  return (await $`git rev-parse HEAD`.cwd(dir).quiet()).stdout.toString().trim();
}

async function docs(...args: readonly string[]): Promise<{ exitCode: number; text: string }> {
  const result = await $`bun ${SCRIPT} ${args}`.cwd(dir).nothrow().quiet();
  return { exitCode: result.exitCode, text: result.stdout.toString() + result.stderr.toString() };
}

function fixture(kind: Kind): Promise<string> {
  return readFile(join(FIXTURES, `${kind}.md`), "utf8");
}

test(
  "a planted non-conforming file of each kind goes red, and green once it holds to its template",
  async () => {
    await initRepo(QUALITY);
    let previous = await commit("start");
    for (const { kind, path, defect, refusal } of PLANTS) {
      const conforming = await fixture(kind);
      await put(path, defect(conforming));
      const planted = await commit(`plant a ${kind} that breaks its template`);
      const red = await docs(previous, planted);
      expect(red.text).toContain(`  ${refusal}`);
      expect(red.exitCode).toBe(1);

      await put(path, conforming);
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
    await initRepo({});
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
    expect(held.text).toContain("docs: 4 violation(s) in the doc files the range touches:\n  README.md:1: lacks `## Before you begin`");
    expect(held.exitCode).toBe(1);
  },
  120_000,
);

test(
  "a page under docs/ needs a declared mode, and a record may not take a number another holds",
  async () => {
    await initRepo({});
    await put("docs/adr/0001-a-part-names-its-supplier.md", await fixture("adr"));
    const base = await commit("one record");
    await put("docs/parts.md", await fixture("reference"));
    await put("docs/adr/0001-a-second-record.md", (await fixture("adr")).replace("A part names", "A record reuses"));
    const head = await commit("an undeclared page and a record with a taken number");

    const red = await docs(base, head);
    expect(red.text).toContain("  docs/adr/0001-a-second-record.md:1: shares number 1 with docs/adr/0001-a-part-names-its-supplier.md\n");
    expect(red.text).toContain("  docs/parts.md: is a page under docs/ with no mode; declare it under docs.pages in quality.json");
    expect(red.exitCode).toBe(1);

    await writeFile(join(dir, "quality.json"), JSON.stringify({ docs: { pages: { reference: ["docs/*.md"] } } }));
    await rm(join(dir, "docs/adr/0001-a-second-record.md"));
    const fixed = await commit("declare the page and drop the second record");
    const green = await docs(base, fixed);
    expect(green.text).toContain("docs: 1 doc file(s) the range touches hold to their templates");
    expect(green.exitCode).toBe(0);
  },
  120_000,
);

test(
  "a quality.json that declares a mode no template has is undecided, not a pass",
  async () => {
    await initRepo({ docs: { pages: { guide: ["docs/*.md"] } } });
    const head = await commit("an unknown mode");
    const undecided = await docs(head);
    expect(undecided.text).toContain("docs: quality.json:");
    expect(undecided.exitCode).toBe(2);
  },
  120_000,
);
