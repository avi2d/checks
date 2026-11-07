import { expect, test } from "bun:test";
import { docsRepos, GUIDE, OPENING, putAgentFiles, ROOT_AGENTS, type DocsRepo } from "./lib/docs-repo.ts";

const repository = docsRepos();

function initRepo(): Promise<DocsRepo> {
  return repository();
}

const MANIFEST = JSON.stringify({ name: "widget" });
const MISSING_CLAUDE =
  "  CLAUDE.md: is missing from the repository root, which holds a `package.json`. Copy `node_modules/@avi2dg/checks/dist/templates/claude.md` to `CLAUDE.md` word for word";
const MISSING_AGENTS =
  "  AGENTS.md: is missing from the repository root, which holds a `package.json`. Copy `node_modules/@avi2dg/checks/dist/templates/agents.md` to `AGENTS.md`";
const HELD = "docs: the repository root holds the AGENTS.md and CLAUDE.md its package.json calls for";

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
  "a repository with no package.json at its root passes a range that edits its docs without AGENTS.md or CLAUDE.md, even beside a nested package.json",
  async () => {
    const { put, commit, docs } = await initRepo();
    await put("packages/run/package.json", MANIFEST);
    await put(GUIDE, OPENING);
    const previous = await commit("no manifest at the root");
    await put(GUIDE, `${OPENING}It prints a bill.\n`);
    const edited = await commit("edit a doc");

    const green = await docs(previous, edited);
    expect(green.text).not.toContain("is missing from the repository root");
    expect(green.text).not.toContain(HELD);
    expect(green.exitCode).toBe(0);
  },
  120_000,
);
