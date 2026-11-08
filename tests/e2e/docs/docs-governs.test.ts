import { expect, test } from "bun:test";
import { docsRepos } from "../lib/docs-repo.ts";

const FIRST = "docs/adr/0001-a-part-names-its-supplier.md";
const SECOND = "docs/adr/0002-a-spare-names-its-supplier.md";

function record(number: number, frontMatter: string, status: string, decision = "A part names its supplier."): string {
  const head = frontMatter === "" ? "" : `---\n${frontMatter}\n---\n`;
  return `${head}# ${number}. A part names its supplier\n\nDate: 2026-09-24\n\n## Status\n\n${status}\n\n## Context\n\nTwo suppliers sell the same part.\n\n## Decision\n\n${decision}\n`;
}

const repository = docsRepos();

test(
  "a record with no governs field is refused rather than passed, and passes once it lists a tracked path",
  async () => {
    const { put, commit, docs } = await repository();
    const base = await commit("start");
    await put(FIRST, record(1, "", "Accepted."));
    const ungoverned = await commit("a record that governs nothing");

    const red = await docs(base, ungoverned);
    expect(red.text).toContain(`  ${FIRST}:1: has no \`governs\` in its front matter`);
    expect(red.exitCode).toBe(1);

    await put(FIRST, record(1, "governs: [widget.ts]", "Accepted."));
    const governed = await commit("the record governs widget.ts");
    const green = await docs(base, governed);
    expect(green.text).toContain("docs: 1 doc file(s) the range touches hold to their templates");
    expect(green.exitCode).toBe(0);
  },
  120_000,
);

test(
  "a governs path missing from the repository is refused with the record and the path, not passed",
  async () => {
    const { put, commit, docs } = await repository();
    const base = await commit("start");
    await put(FIRST, record(1, "governs: [widget.ts, src/parts.ts]", "Accepted."));
    const head = await commit("a record that governs a file the repository lacks");

    const red = await docs(base, head);
    expect(red.text).toContain(`  ${FIRST}:2: governs \`src/parts.ts\`, which is not in the repository`);
    expect(red.text).not.toContain("governs `widget.ts`");
    expect(red.exitCode).toBe(1);
  },
  120_000,
);

test(
  "deleting a governed file without retiring its record is refused, even when the range leaves the record alone",
  async () => {
    const { put, remove, commit, docs } = await repository();
    await put(FIRST, record(1, "governs: [widget.ts]", "Accepted."));
    const base = await commit("a record that governs widget.ts");
    await remove("widget.ts");
    const deleted = await commit("delete the governed file");

    const red = await docs(base, deleted);
    expect(red.text).toContain(`  ${FIRST}:2: governs \`widget.ts\`, which the range deletes`);
    expect(red.exitCode).toBe(1);

    await put(FIRST, record(1, "governs: [widget.ts]", "Retired. The widget is gone, so parts no longer name a supplier through it."));
    const retired = await commit("retire the record with the file");
    const green = await docs(base, retired);
    expect(green.text).toContain("docs: 1 doc file(s) the range touches hold to their templates");
    expect(green.exitCode).toBe(0);
  },
  120_000,
);

test(
  "a supersession stated outside Status is refused rather than passed, and passes once Status carries it",
  async () => {
    const { put, commit, docs } = await repository();
    await put(FIRST, record(1, "governs: [widget.ts]", "Accepted."));
    const base = await commit("one record");
    await put(SECOND, record(2, "governs: [widget.ts]", "Accepted.", "A spare names its supplier.\nThis record supersedes record 0001."));
    const outside = await commit("a second record that supersedes the first in its Decision");

    const red = await docs(base, outside);
    expect(red.text).toContain(`  ${SECOND}:19: states a supersession of 0001 outside \`## Status\``);
    expect(red.exitCode).toBe(1);

    await put(FIRST, record(1, "governs: [widget.ts]", "Superseded by 0002: a spare names its supplier."));
    await put(SECOND, record(2, "governs: [widget.ts]", "Accepted. Supersedes 0001: a spare names its supplier.", "A spare names its supplier."));
    const inStatus = await commit("move the supersession into both Status sections");
    const green = await docs(base, inStatus);
    expect(green.text).toContain("docs: 2 doc file(s) the range touches hold to their templates");
    expect(green.exitCode).toBe(0);
  },
  120_000,
);
