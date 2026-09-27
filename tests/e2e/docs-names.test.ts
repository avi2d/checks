import { expect, test } from "bun:test";
import { docsRepos, GUIDE, OPENING } from "./lib/docs-repo.ts";

const MANIFEST = JSON.stringify({ name: "widget", scripts: { build: "bun scripts/build.ts" } });

const repository = docsRepos();

test(
  "a name the range removes from every file outside the docs fails, on any line a doc or agent file names it",
  async () => {
    const { put, commit, docs } = await repository();
    await put("package.json", MANIFEST);
    await put("widget.ts", "export const sprocket = 1;\n");
    await put(GUIDE, `${OPENING}It builds \`sprocket\`.\n`);
    await put("tools/AGENTS.md", "# Tools\n\nIt ships `sprocket`.\n");
    const base = await commit("a doc and an agent file name a helper");
    await put("widget.ts", "export const gadget = 1;\n");
    const head = await commit("rename the helper everywhere but the docs");

    const refused = await docs(base, head);
    expect(refused.text).toContain(
      `  ${GUIDE}:4: names \`sprocket\`, which the range removed from every file outside the docs. Say what holds now, or drop the line`,
    );
    expect(refused.text).toContain(
      "  tools/AGENTS.md:3: names `sprocket`, which the range removed from every file outside the docs. Say what holds now, or drop the line",
    );
    expect(refused.exitCode).toBe(1);
  },
  120_000,
);

test(
  "a name the reference check already reports as a broken path is not reported a second time",
  async () => {
    const { put, remove, commit, docs } = await repository();
    await put("package.json", MANIFEST);
    await put("scripts/build.ts", "export const build = 1;\n");
    await put(GUIDE, `${OPENING}It runs \`scripts/build.ts\`.\n`);
    const base = await commit("a guide names a script");
    await remove("scripts/build.ts");
    await put("package.json", JSON.stringify({ name: "widget", scripts: {} }));
    const head = await commit("delete the script and its entry");

    const refused = await docs(base, head);
    expect(refused.text).toContain(`  ${GUIDE}:4: names \`scripts/build.ts\`, which is not in the repository`);
    expect(refused.text).not.toContain("which the range removed from every file outside the docs");
    expect(refused.exitCode).toBe(1);
  },
  120_000,
);
