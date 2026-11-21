import { expect, test } from "bun:test";
import { docsRepos, GUIDE, OPENING, putAgentFiles, putVision, VISION, visionPage, type DocsRepo } from "../lib/docs-repo.ts";

const repository = docsRepos();

const MANIFEST = JSON.stringify({ name: "widget", devDependencies: { "@avi2dg/checks": "1.0.0" } });
const KIT_MANIFEST = JSON.stringify({ name: "@avi2dg/checks" });
const STANDALONE_MANIFEST = JSON.stringify({ name: "checks" });
const MISSING_VISION =
  "  VISION.md: is missing from the repository root. Copy `node_modules/@avi2dg/checks/dist/templates/vision.md` to `VISION.md`";
const HELD = "docs: the repository root holds VISION.md";

async function packageRepo(manifest = MANIFEST): Promise<DocsRepo> {
  const repo = await repository();
  await repo.put("package.json", manifest);
  await putAgentFiles(repo.put);
  await repo.put(GUIDE, OPENING);
  return repo;
}

test(
  "a kit consumer cannot edit docs without VISION.md even when its package name is unrelated to the kit",
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
  "the kit itself sees a missing VISION.md advisory on code changes even without a kit dependency",
  async () => {
    const { put, commit, docs } = await packageRepo(KIT_MANIFEST);
    const previous = await commit("a package with no vision page");
    await put("widget.ts", "export const widget = 2;\n");
    const head = await commit("change code alone");

    const quiet = await docs(previous, head);
    expect(quiet.text).toContain("docs: advisory, VISION.md is missing, and the first range that edits a doc adds it:");
    expect(quiet.text).toContain(MISSING_VISION);
    expect(quiet.exitCode).toBe(0);
  },
  120_000,
);

test(
  "a vision page without the aligns closing line fails naming that line rather than passing on the resisted line",
  async () => {
    const { put, commit, docs } = await packageRepo();
    const previous = await commit("a package with no vision page");
    const page = await visionPage();
    await put(VISION, page.replace("A change aligns when it makes the bill cheaper to trust.\n", ""));
    const added = await commit("add a vision page with no aligns line");

    const red = await docs(previous, added);
    expect(red.text).toContain(`  ${VISION}:1: lacks an \`A change aligns when ...\` closing line`);
    expect(red.text).not.toContain(MISSING_VISION);
    expect(red.exitCode).toBe(1);
  },
  120_000,
);

test(
  "a vision page repeating a readme line fails naming the line rather than passing as a fresh rule",
  async () => {
    const { put, commit, docs } = await packageRepo();
    await put("README.md", "# widget\n\nThe tools build bills.\n");
    const previous = await commit("a package with a readme");
    const page = await visionPage();
    await put(
      VISION,
      page.replace("- It prices the build alone, it never orders a part, and it takes the trade of a bill that never leaves the desk.", "The tools build bills."),
    );
    const added = await commit("add a vision page repeating the readme");

    const red = await docs(previous, added);
    expect(red.text).toContain(`  ${VISION}:9: repeats a line from README.md: "The tools build bills."`);
    expect(red.text).not.toContain(MISSING_VISION);
    expect(red.exitCode).toBe(1);
  },
  120_000,
);

test(
  "a readme repeating an agent line fails naming the line rather than passing as a second copy",
  async () => {
    const { put, commit, docs } = await packageRepo();
    const previous = await commit("a package with an agent file");
    await put("README.md", "# widget\n\nThe fixture builds bills, and README.md holds what a person reads.\n");
    const added = await commit("add a readme repeating the agent file");

    const red = await docs(previous, added);
    expect(red.text).toContain(`  README.md:3: repeats a line from AGENTS.md: "The fixture builds bills, and README.md holds what a person reads."`);
    expect(red.exitCode).toBe(1);
  },
  120_000,
);
test(
  "a repository named checks without the kit dependency does not need VISION.md",
  async () => {
    const repo = await repository();
    await repo.put("package.json", STANDALONE_MANIFEST);
    await putAgentFiles(repo.put);
    await repo.put(GUIDE, OPENING);
    const previous = await repo.commit("a standalone package with no vision page");
    await repo.put(GUIDE, `${OPENING}It prints a bill.\n`);
    const edited = await repo.commit("edit a doc");

    const green = await repo.docs(previous, edited);
    expect(green.text).not.toContain(VISION);
    expect(green.exitCode).toBe(0);
  },
  120_000,
);

test(
  "a repository with no package.json does not ask for VISION.md when a range edits its docs",
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
