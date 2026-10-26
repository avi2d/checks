import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { docsRepos, GUIDE, OPENING, plantRedThenGreen, type DocsRepo, type Plant } from "./lib/docs-repo.ts";

const MANIFEST = JSON.stringify({ name: "widget", scripts: { build: "bun scripts/build.ts" } });

const PLANTS: readonly (Plant & { readonly reference: string })[] = [
  {
    reference: "a path",
    red: "It runs `scripts/bild.ts`.",
    refusal: "4: names `scripts/bild.ts`, which is not in the repository",
    green: "It runs `scripts/build.ts`.",
  },
  {
    reference: "a link",
    red: "It builds [the widget](../widgt.ts).",
    refusal: "4: links to `../widgt.ts`, which is not in the repository",
    green: "It builds [the widget](../widget.ts).",
  },
  {
    reference: "an anchor",
    red: "It opens at [the top](#toolz).",
    refusal: "4: links to `#toolz`, and `tools/README.md` has no heading with that anchor",
    green: "It opens at [the top](#tools).",
  },
  {
    reference: "a command",
    red: "Run `bun run bild`.",
    refusal: "4: runs `bun run bild`, and `bild` is not a script in `package.json`",
    green: "Run `bun run build`.",
  },
];

const repository = docsRepos();

async function start(): Promise<DocsRepo> {
  const repo = await repository();
  await repo.put("package.json", MANIFEST);
  await repo.put("scripts/build.ts", "export const build = 1;\n");
  return repo;
}

test(
  "each reference goes red on a line a change adds to a living doc, and green once it resolves",
  async () => {
    await plantRedThenGreen(
      await start(),
      PLANTS,
      ({ reference }) => [`plant ${reference} that resolves nowhere`, `point ${reference} at what exists`],
      "docs: the range breaks no path, link or command the 1 living doc(s) or agent file(s) name",
    );
  },
  120_000,
);

test(
  "a path an agent file names goes red on a line a change adds, and green once it resolves",
  async () => {
    const { put, commit, docs } = await start();
    await put("tools/AGENTS.md", "# Tools\n\nIt runs `scripts/bild.ts`.\n");
    const planted = await commit("an agent file names a path that resolves nowhere");

    const refused = await docs(planted);
    expect(refused.text).toContain("  tools/AGENTS.md:3: names `scripts/bild.ts`, which is not in the repository");
    expect(refused.exitCode).toBe(1);

    await put("tools/AGENTS.md", "# Tools\n\nIt runs `scripts/build.ts`.\n");
    const fixed = await commit("point the agent file at what exists");
    const kept = await docs(planted, fixed);
    expect(kept.text).toContain("docs: the range breaks no path, link or command the 1 living doc(s) or agent file(s) name");
    expect(kept.exitCode).toBe(0);
  },
  120_000,
);

test(
  "a range that breaks a reference on a line it leaves alone fails, and one broken before it is advisory",
  async () => {
    const { put, remove, commit, docs } = await start();
    await put(GUIDE, `${OPENING}It runs \`scripts/build.ts\` through \`bun run build\`.\nIt once ran \`scripts/legacy.ts\`.\n`);
    const base = await commit("a guide with one path already broken");
    await put("widget.ts", "export const widget = 2;\n");
    const unrelated = await commit("change code the guide does not name");

    const quiet = await docs(base, unrelated);
    expect(quiet.text).toContain(
      "docs: advisory, 1 path(s), link(s) or command(s) the living docs or agent files name were broken before the range:\n" +
        `  ${GUIDE}:5: names \`scripts/legacy.ts\`, which is not in the repository`,
    );
    expect(quiet.exitCode).toBe(0);

    await remove("scripts/build.ts");
    await put("package.json", JSON.stringify({ name: "widget", scripts: {} }));
    const deleted = await commit("delete the build and its script");
    const broken = await docs(unrelated, deleted);
    expect(broken.text).toContain(`  ${GUIDE}:4: names \`scripts/build.ts\`, which is not in the repository`);
    expect(broken.text).toContain(`  ${GUIDE}:4: runs \`bun run build\`, and \`build\` is not a script in \`package.json\``);
    const [violations = ""] = broken.text.split("docs: advisory");
    expect(violations).not.toContain(`${GUIDE}:5:`);
    expect(broken.exitCode).toBe(1);
  },
  120_000,
);

test(
  "a path git ignores or a bin a dependency installs is not held to the repository",
  async () => {
    const { put, commit, docs } = await start();
    await put("generated/keep.txt", "kept\n");
    await put(GUIDE, OPENING);
    const base = await commit("start");
    await put(GUIDE, `${OPENING}It writes \`generated/schema.json\`.\nRun \`bun run checks-lint\`.\n`);
    const head = await commit("name a generated file and an installed bin");

    const red = await docs(base, head);
    expect(red.text).toContain(`  ${GUIDE}:4: names \`generated/schema.json\`, which is not in the repository`);
    expect(red.text).toContain(`  ${GUIDE}:5: runs \`bun run checks-lint\`, and \`checks-lint\` is not a script in \`package.json\``);
    expect(red.exitCode).toBe(1);

    await put(".gitignore", "generated/*.json\nnode_modules/\n");
    await put("node_modules/.bin/checks-lint", "#!/bin/sh\n");
    const green = await docs(base, head);
    expect(green.text).toContain("docs: the range breaks no path, link or command the 1 living doc(s) or agent file(s) name");
    expect(green.exitCode).toBe(0);
  },
  120_000,
);

test(
  "a README's command that names no script goes red, and green once front matter marks the page as speaking to consumers",
  async () => {
    const { put, commit, docs } = await repository();
    const readme = await readFile(join(import.meta.dir, "..", "fixtures", "docs", "readme.md"), "utf8");
    const shipped = readme.replace("prints the version.\n", "prints the version.\nRun `bun run deploy` to ship it.\n");
    await put("package.json", JSON.stringify({ name: "widget", scripts: { widget: "bun widget.ts" } }));
    await put("README.md", readme);
    const base = await commit("a README that holds to its template");
    await put("README.md", shipped);
    const named = await commit("name a deploy script the package lacks");

    const red = await docs(base, named);
    expect(red.text).toContain("  README.md:19: runs `bun run deploy`, and `deploy` is not a script in `package.json`");
    expect(red.exitCode).toBe(1);

    await put("README.md", `---\naudience: consumers\n---\n${shipped}`);
    const marked = await commit("mark the README as speaking to consumers");
    const green = await docs(base, marked);
    expect(green.text).toContain("docs: the range breaks no path, link or command the 1 living doc(s) or agent file(s) name");
    expect(green.exitCode).toBe(0);
  },
  120_000,
);
