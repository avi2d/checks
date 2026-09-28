import { expect, test } from "bun:test";
import { docsRepos, type DocsRepo } from "./lib/docs-repo.ts";

const repository = docsRepos();

function initRepo(): Promise<DocsRepo> {
  return repository();
}

const MAINTAINING = [
  "## Maintaining this file",
  "",
  "Keep this file for knowledge useful to almost every future agent session in this project.",
  "Do not repeat what the codebase already shows.",
  "Point to the authoritative file or command instead.",
  "Prefer rewriting or pruning existing entries over appending new ones.",
  "When updating this file, preserve this bar for all agents and keep entries concise.",
  "",
].join("\n");

const COMPLIANT = [
  "# Project agent memory",
  "",
  "The fixture builds a bill of materials, and `README.md` holds what a person reads.",
  "",
  "## Parts",
  "",
  "- Edit `src/parts.toml` instead of the generated `src/parts.json`.",
  "",
  MAINTAINING,
].join("\n");

async function putParts(put: DocsRepo["put"]): Promise<void> {
  await put("src/parts.toml", "[parts]\n");
  await put("src/parts.json", "{}\n");
}

function oversized(text: string): string {
  return `${text}${"x".repeat(13225 - text.length)}`;
}

test(
  "an agent file at the skills size goes red on the ceiling, and green once it is a router",
  async () => {
    const { put, commit, docs } = await initRepo();
    await putParts(put);
    const previous = await commit("start");
    expect(oversized(COMPLIANT).length).toBe(13225);
    await put("AGENTS.md", oversized(COMPLIANT));
    const planted = await commit("an agent file at the skills size");

    const red = await docs(previous, planted);
    expect(red.text).toContain("  AGENTS.md: is 13225 characters, over the 3,000-character ceiling for agent files");
    expect(red.exitCode).toBe(1);

    await put("AGENTS.md", COMPLIANT);
    const fixed = await commit("a router under the ceiling");
    const green = await docs(planted, fixed);
    expect(green.text).toContain("docs: the 1 agent file(s) hold to the ceiling, and every entry names a tracked path, a link or a command");
    expect(green.exitCode).toBe(0);
  },
  120_000,
);

test(
  "an entry that names nothing goes red, and green once it names the file that holds the detail",
  async () => {
    const { put, commit, docs } = await initRepo();
    await putParts(put);
    await put("AGENTS.md", COMPLIANT);
    const previous = await commit("a router");
    await put("AGENTS.md", COMPLIANT.replace("- Edit `src/parts.toml`", "- Write good code. Edit `src/parts.toml`"));
    const held = await docs(previous, await commit("an entry that still points"));
    expect(held.exitCode).toBe(0);

    await put("AGENTS.md", COMPLIANT.replace("- Edit `src/parts.toml` instead of the generated `src/parts.json`.", "- Write good code."));
    const planted = await commit("an entry that names nothing");
    const red = await docs(previous, planted);
    expect(red.text).toContain("  AGENTS.md:7: names no tracked path, link or `bun run` command");
    expect(red.exitCode).toBe(1);

    await put("AGENTS.md", COMPLIANT);
    const fixed = await commit("an entry that names its file again");
    const green = await docs(planted, fixed);
    expect(green.exitCode).toBe(0);
  },
  120_000,
);

test(
  "an over-ceiling agent file fails even when the range leaves it alone, at the root and nested",
  async () => {
    const { put, commit, docs } = await initRepo();
    await put("AGENTS.md", oversized(COMPLIANT));
    const nested = `${"x".repeat(13224)}\n`;
    expect(nested.length).toBe(13225);
    await put("pkg/CLAUDE.md", nested);
    const previous = await commit("over-ceiling agent files before the range");
    await put("notes.md", "anything\n");
    const head = await commit("touch only another file");

    const red = await docs(previous, head);
    expect(red.text).toContain("  AGENTS.md: is 13225 characters, over the 3,000-character ceiling for agent files");
    expect(red.text).toContain("  pkg/CLAUDE.md: is 13225 characters, over the 3,000-character ceiling for agent files");
    expect(red.exitCode).toBe(1);
  },
  120_000,
);

test(
  "a pointerless entry committed before the range fails when the range touches another file",
  async () => {
    const { put, commit, docs } = await initRepo();
    await putParts(put);
    await put("AGENTS.md", COMPLIANT.replace("- Edit `src/parts.toml` instead of the generated `src/parts.json`.", "- Write good code."));
    const previous = await commit("an entry that names nothing before the range");
    await put("notes.md", "anything\n");
    const head = await commit("touch only another file");

    const red = await docs(previous, head);
    expect(red.text).toContain("  AGENTS.md:7: names no tracked path, link or `bun run` command");
    expect(red.exitCode).toBe(1);

    await put("AGENTS.md", COMPLIANT.replace("- Edit `src/parts.toml` instead of the generated `src/parts.json`.", "- Edit `widget.ts` first."));
    const fixed = await commit("an entry that names a root-level file");
    const green = await docs(head, fixed);
    expect(green.exitCode).toBe(0);
  },
  120_000,
);

test(
  "an entry naming a root file git tracks, such as LICENSE, points, and one naming an untracked root file does not",
  async () => {
    const { put, commit, docs } = await initRepo();
    await putParts(put);
    await put("LICENSE", "MIT\n");
    await put("AGENTS.md", COMPLIANT);
    const previous = await commit("a router and a licence");

    const entry = "- Edit `src/parts.toml` instead of the generated `src/parts.json`.";
    await put("AGENTS.md", COMPLIANT.replace(entry, "- Read `NOTICE` first."));
    const planted = await commit("an entry naming a root file git does not track");
    const red = await docs(previous, planted);
    expect(red.text).toContain("  AGENTS.md:7: names no tracked path, link or `bun run` command");
    expect(red.exitCode).toBe(1);

    await put("AGENTS.md", COMPLIANT.replace(entry, "- Read `LICENSE` first."));
    const fixed = await commit("an entry naming the licence");
    const green = await docs(planted, fixed);
    expect(green.text).toContain("every entry names a tracked path, a link or a command");
    expect(green.exitCode).toBe(0);
  },
  120_000,
);

test(
  "a commented-out entry and an entry in an HTML block stay green when the range touches another file, and a nested file points with ../",
  async () => {
    const { put, commit, docs } = await initRepo();
    await putParts(put);
    const hidden = "<!--\n- Write good code.\n-->\n\n<details>\n- Write better code.\n</details>\n\n";
    await put("AGENTS.md", COMPLIANT.replace("## Parts\n\n", `## Parts\n\n${hidden}`));
    await put("pkg/AGENTS.md", COMPLIANT.replace("- Edit `src/parts.toml` instead of the generated `src/parts.json`.", "- Edit `../src/parts.toml` first."));
    const previous = await commit("hidden entries and a nested router");
    await put("notes.md", "anything\n");
    const head = await commit("touch only another file");

    const green = await docs(previous, head);
    expect(green.text).toContain("docs: the 2 agent file(s) hold to the ceiling, and every entry names a tracked path, a link or a command");
    expect(green.exitCode).toBe(0);
  },
  120_000,
);
