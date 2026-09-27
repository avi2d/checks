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

test(
  "a name the range removes that an installed direct dependency still holds is not reported, even inside a longer name",
  async () => {
    const { put, commit, docs } = await repository();
    await put("package.json", JSON.stringify({ name: "widget", devDependencies: { kit: "1.0.0" } }));
    await put(".gitignore", "node_modules/\n");
    await put("node_modules/kit/oxlintrc.json", JSON.stringify({ rules: { "sprocket-rule": "error" } }));
    await put("widget.ts", "export const sprocket = 'sprocket-rule';\n");
    await put(GUIDE, `${OPENING}It builds \`sprocket\` under \`sprocket-rule\`.\n`);
    const base = await commit("a guide names a rule the repository sets");
    await put("widget.ts", "export const gadget = 1;\n");
    const head = await commit("leave the rule to the installed kit");

    const kept = await docs(base, head);
    expect(kept.text).not.toContain("which the range removed from every file outside the docs");
    expect(kept.exitCode).toBe(0);
  },
  120_000,
);

test(
  "a name the base held only inside a longer name the doc also names still fails when the range removes both",
  async () => {
    const { put, commit, docs } = await repository();
    await put("package.json", MANIFEST);
    await put("widget.ts", "export const rule = 'sprocket-rule';\n");
    await put(GUIDE, `${OPENING}It builds \`sprocket\`.\nIt sets \`sprocket-rule\`.\n`);
    const base = await commit("a guide names a rule and its prefix");
    await put("widget.ts", "export const gadget = 1;\n");
    const head = await commit("drop the rule");

    const refused = await docs(base, head);
    expect(refused.text).toContain(
      `  ${GUIDE}:4: names \`sprocket\`, which the range removed from every file outside the docs. Say what holds now, or drop the line`,
    );
    expect(refused.text).toContain(
      `  ${GUIDE}:5: names \`sprocket-rule\`, which the range removed from every file outside the docs. Say what holds now, or drop the line`,
    );
    expect(refused.exitCode).toBe(1);
  },
  120_000,
);

test(
  "a name the range removes still fails when the path check lists it only as broken before the range",
  async () => {
    const { put, commit, docs } = await repository();
    await put("package.json", JSON.stringify({ name: "widget", scripts: { legacy: "bun scripts/legacy.ts" } }));
    await put("scripts/build.ts", "export const build = 1;\n");
    await put(GUIDE, `${OPENING}It runs \`scripts/legacy.ts\`.\n`);
    const base = await commit("a guide names a script that is already gone");
    await put("package.json", JSON.stringify({ name: "widget", scripts: {} }));
    const head = await commit("drop the script entry");

    const refused = await docs(base, head);
    expect(refused.text).toContain(
      `  ${GUIDE}:4: names \`scripts/legacy.ts\`, which the range removed from every file outside the docs. Say what holds now, or drop the line`,
    );
    expect(refused.exitCode).toBe(1);
  },
  120_000,
);
