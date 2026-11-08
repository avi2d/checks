import { expect, test } from "bun:test";
import { docsRepos, GUIDE, OPENING, putAgentFiles, putVision, VISION, visionPage, type DocsRepo } from "../lib/docs-repo.ts";

const repository = docsRepos();

const MANIFEST = JSON.stringify({ name: "widget" });
const MISSING_VISION =
  "  docs/vision.md: is missing, and it holds the vision a repository with a `package.json` keeps. Copy `node_modules/@avi2dg/checks/dist/templates/vision.md` to `docs/vision.md`";
const HELD = "docs: docs/vision.md holds the vision a repository with a `package.json` keeps";

async function packageRepo(): Promise<DocsRepo> {
  const repo = await repository();
  await repo.put("package.json", MANIFEST);
  await putAgentFiles(repo.put);
  await repo.put(GUIDE, OPENING);
  return repo;
}

test(
  "a package repository without docs/vision.md fails a range that edits its docs naming the vision template, and passes once the page is added",
  async () => {
    const { put, commit, docs } = await packageRepo();
    const previous = await commit("a package with no vision page");
    await put(GUIDE, `${OPENING}It prints a bill.\n`);
    const edited = await commit("edit a doc");

    const red = await docs(previous, edited);
    expect(red.text).toContain(MISSING_VISION);
    expect(red.text).not.toContain(HELD);
    expect(red.exitCode).toBe(1);

    await putVision(put);
    const fixed = await commit("add the vision page");
    const green = await docs(edited, fixed);
    expect(green.text).toContain("docs: 1 doc file(s) the range touches hold to their templates");
    expect(green.text).toContain(HELD);
    expect(green.exitCode).toBe(0);
  },
  120_000,
);

test(
  "a package repository without docs/vision.md does not fail a range that leaves its docs alone, and lists the page as advisory",
  async () => {
    const { put, commit, docs } = await packageRepo();
    const previous = await commit("a package with no vision page");
    await put("widget.ts", "export const widget = 2;\n");
    const head = await commit("change code alone");

    const quiet = await docs(previous, head);
    expect(quiet.text).toContain("docs: advisory, docs/vision.md is missing, and the first range that edits a doc adds it:");
    expect(quiet.text).toContain(MISSING_VISION);
    expect(quiet.exitCode).toBe(0);
  },
  120_000,
);

test(
  "a vision page without its Non-goals section fails naming that section rather than passing on the other five",
  async () => {
    const { put, commit, docs } = await packageRepo();
    const previous = await commit("a package with no vision page");
    const page = await visionPage();
    await put(VISION, page.replace(/## Non-goals\n\n(?:- .*\n)+\n/, ""));
    const added = await commit("add a vision page with five sections");

    const red = await docs(previous, added);
    expect(red.text).toContain(`  ${VISION}:1: lacks \`## Non-goals\``);
    expect(red.text).not.toContain(MISSING_VISION);
    expect(red.exitCode).toBe(1);
  },
  120_000,
);

test(
  "a repository with no package.json does not ask for docs/vision.md when a range edits its docs",
  async () => {
    const { put, commit, docs } = await repository();
    await put(GUIDE, OPENING);
    const previous = await commit("a repository with no manifest");
    await put(GUIDE, `${OPENING}It prints a bill.\n`);
    const edited = await commit("edit a doc");

    const green = await docs(previous, edited);
    expect(green.text).not.toContain(VISION);
    expect(green.exitCode).toBe(0);
  },
  120_000,
);
