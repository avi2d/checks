import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { CHECKOUT } from "./lib/fixture-repo.ts";
import { docsRepos, GUIDE, OPENING, putAgentFiles, ROOT_AGENTS, type DocsRepo } from "./lib/docs-repo.ts";

const repository = docsRepos();

function initRepo(): Promise<DocsRepo> {
  return repository();
}

const MANIFEST = JSON.stringify({ name: "widget" });
const MISSING_CLAUDE =
  "  CLAUDE.md: is missing from the repository root, which a repository with a `package.json` keeps. Copy `node_modules/@avi2dg/checks/dist/templates/claude.md` to `CLAUDE.md` word for word";
const MISSING_AGENTS =
  "  AGENTS.md: is missing from the repository root, which a repository with a `package.json` keeps. Copy `node_modules/@avi2dg/checks/dist/templates/agents.md` to `AGENTS.md`";
const HELD = "docs: the repository root holds the AGENTS.md and CLAUDE.md a repository with a `package.json` keeps";

test(
  "a package repository without CLAUDE.md fails a range that edits its docs, and passes once CLAUDE.md is added",
  async () => {
    const { put, commit, docs } = await initRepo();
    await put("package.json", MANIFEST);
    await put("AGENTS.md", ROOT_AGENTS);
    await put(GUIDE, OPENING);
    const previous = await commit("a package with AGENTS.md alone");
    await put(GUIDE, `${OPENING}It prints a bill.\n`);
    const edited = await commit("edit a doc");

    const red = await docs(previous, edited);
    expect(red.text).toContain(MISSING_CLAUDE);
    expect(red.text).not.toContain("  AGENTS.md: is missing");
    expect(red.exitCode).toBe(1);

    await putAgentFiles(put);
    const fixed = await commit("add CLAUDE.md");
    const green = await docs(edited, fixed);
    expect(green.text).toContain(HELD);
    expect(green.exitCode).toBe(0);
  },
  120_000,
);

test(
  "a package repository without AGENTS.md or CLAUDE.md does not fail a range that leaves its docs alone, and lists both as advisory",
  async () => {
    const { put, commit, docs } = await initRepo();
    await put("package.json", MANIFEST);
    await put(GUIDE, OPENING);
    const previous = await commit("a package with no agent files");
    await put("widget.ts", "export const widget = 2;\n");
    const head = await commit("change code alone");

    const quiet = await docs(previous, head);
    expect(quiet.text).toContain(
      "docs: advisory, 2 agent file(s) missing from the repository root, which the first range that edits a doc adds:",
    );
    expect(quiet.text).toContain(MISSING_AGENTS);
    expect(quiet.text).toContain(MISSING_CLAUDE);
    expect(quiet.text).not.toContain(HELD);
    expect(quiet.exitCode).toBe(0);
  },
  120_000,
);

test(
  "a package repository without CLAUDE.md fails a range that adds only an ADR rather than leaving the file advisory",
  async () => {
    const { put, commit, docs } = await initRepo();
    await put("package.json", MANIFEST);
    await put("AGENTS.md", ROOT_AGENTS);
    const previous = await commit("a package with AGENTS.md alone");
    await put("docs/adr/0001-a-part-names-its-supplier.md", await readFile(join(CHECKOUT, "tests", "fixtures", "docs", "adr.md"), "utf8"));
    const recorded = await commit("add an ADR");

    const red = await docs(previous, recorded);
    expect(red.text).toContain(MISSING_CLAUDE);
    expect(red.text).not.toContain("agent file(s) missing from the repository root");
    expect(red.exitCode).toBe(1);
  },
  120_000,
);

test(
  "a package repository without CLAUDE.md does not fail a range that adds only a changeset, and lists the file as advisory",
  async () => {
    const { put, commit, docs } = await initRepo();
    await put("package.json", MANIFEST);
    await put("AGENTS.md", ROOT_AGENTS);
    const previous = await commit("a package with AGENTS.md alone");
    await put(".changeset/brave-fox.md", "---\n\"widget\": patch\n---\n\nFix the bill.\n");
    const head = await commit("add a changeset");

    const quiet = await docs(previous, head);
    expect(quiet.text).toContain(
      "docs: advisory, 1 agent file(s) missing from the repository root, which the first range that edits a doc adds:",
    );
    expect(quiet.text).toContain(MISSING_CLAUDE);
    expect(quiet.exitCode).toBe(0);
  },
  120_000,
);

test(
  "a range that deletes CLAUDE.md from a package repository fails rather than passing as a range that edits no doc",
  async () => {
    const { put, remove, commit, docs } = await initRepo();
    await put("package.json", MANIFEST);
    await putAgentFiles(put);
    const previous = await commit("a package with both agent files");
    await remove("CLAUDE.md");
    const deleted = await commit("delete CLAUDE.md");

    const red = await docs(previous, deleted);
    expect(red.text).toContain(MISSING_CLAUDE);
    expect(red.exitCode).toBe(1);
  },
  120_000,
);

test(
  "a repository whose only package.json is nested still fails a range that edits its docs without AGENTS.md or CLAUDE.md",
  async () => {
    const { put, commit, docs } = await initRepo();
    await put("packages/run/package.json", MANIFEST);
    await put(GUIDE, OPENING);
    const previous = await commit("a nested-only manifest with no agent files");
    await put(GUIDE, `${OPENING}It prints a bill.\n`);
    const edited = await commit("edit a doc");

    const red = await docs(previous, edited);
    expect(red.text).toContain(MISSING_AGENTS);
    expect(red.text).toContain(MISSING_CLAUDE);
    expect(red.text).not.toContain("agent file(s) missing from the repository root");
    expect(red.exitCode).toBe(1);
  },
  120_000,
);

test(
  "a package repository without CLAUDE.md fails a range that deletes only a moded doc outside docs",
  async () => {
    const { put, remove, commit, docs } = await initRepo();
    await put("package.json", MANIFEST);
    await put("AGENTS.md", ROOT_AGENTS);
    await put("guides/setup.md", "---\nkind: how-to\n---\n# Set up the widget\n\nFollow the steps.\n");
    const previous = await commit("a package with a moded doc outside docs");
    await remove("guides/setup.md");
    const deleted = await commit("delete the moded doc");

    const red = await docs(previous, deleted);
    expect(red.text).toContain(MISSING_CLAUDE);
    expect(red.text).not.toContain("agent file(s) missing from the repository root");
    expect(red.exitCode).toBe(1);
  },
  120_000,
);
