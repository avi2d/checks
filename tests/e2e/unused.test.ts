import { $ } from "bun";
import { expect, test } from "bun:test";
import { join } from "node:path";
import { CHECKOUT, fixtureRepos, lintWiring, ran } from "./lib/fixture-repo.ts";

const open = fixtureRepos("checks-unused-");

function configured(files: Readonly<Record<string, string>>): Readonly<Record<string, string>> {
  return {
    "package.json": JSON.stringify({ name: "unused-fixture", type: "module" }),
    ...files,
  };
}

function extendingBase(entry: readonly string[]): string {
  return `import base from "${CHECKOUT}/knip-base.json";\nexport default { ...base, entry: ${JSON.stringify(entry)} };\n`;
}

test(
  "red on an unreferenced TypeScript file and green once it is removed, while an unused export or a dead script outside TypeScript never fails",
  async () => {
    const { dir, commit, script } = await open(
      configured({
        "knip.config.ts": extendingBase(["src/index.ts"]),
        "src/index.ts": `import { used } from "./used.ts";\n\nexport const index = used;\nexport const unusedExport = 1;\n`,
        "src/used.ts": `export const used = 1;\nexport const unusedExport = 2;\n`,
        "src/dead.ts": `export const dead = 1;\n`,
        "scripts/dead.mjs": `export const dead = 1;\n`,
      }),
    );
    await commit("feat: base");

    const red = await script("complexity/unused.ts");
    expect(red.text).toContain("unused: 1 unreferenced file(s):\n  src/dead.ts\n");
    expect(red.text).not.toContain("unusedExport");
    expect(red.exitCode).toBe(1);

    await $`rm src/dead.ts && git add -A`.cwd(dir).quiet();
    const green = await script("complexity/unused.ts");
    expect(green.text).toContain("unused: no unreferenced files among 3 tracked .ts/.tsx file(s)");
    expect(green.exitCode).toBe(0);
  },
  120_000,
);

test(
  "a package.json knip key names entries without a config file",
  async () => {
    const { commit, script } = await open({
      "package.json": JSON.stringify({ name: "unused-fixture", type: "module", knip: { entry: ["index.ts"], include: ["files"] } }),
      "index.ts": `export const index = 1;\n`,
      "dead.ts": `export const dead = 1;\n`,
    });
    await commit("feat: base");

    const red = await script("complexity/unused.ts");
    expect(red.text).toContain("  dead.ts");
    expect(red.exitCode).toBe(1);
  },
  120_000,
);

test(
  "fails when no TypeScript source is tracked",
  async () => {
    const untracked = await open(configured({ "knip.json": JSON.stringify({ entry: ["index.ts"] }) }));
    await untracked.write({ "index.ts": `export const index = 1;\n` });
    const empty = await untracked.script("complexity/unused.ts");
    expect(empty.text).toContain("unused: no tracked .ts or .tsx files to scan");
    expect(empty.exitCode).toBe(2);
  },
  120_000,
);

test(
  "forced colour and other issue types reported beside the files leave the dead file the only one named",
  async () => {
    const { dir, commit } = await open(
      configured({
        "knip.json": JSON.stringify({ entry: ["src/index.ts"] }),
        "src/index.ts": `import { z } from "zod";\n\nexport const index = z;\n`,
        "src/dead.ts": `export const dead = 1;\n`,
      }),
    );
    await commit("feat: base");

    const red = await ran($`bun ${join(CHECKOUT, "src", "complexity", "unused.ts")}`.cwd(dir).env({ ...process.env, FORCE_COLOR: "1" }));
    expect(red.text).toBe("unused: 1 unreferenced file(s):\n  src/dead.ts\n");
    expect(red.exitCode).toBe(1);
  },
  120_000,
);

test(
  "fails when the repository holds no knip configuration",
  async () => {
    const { commit, script } = await open(configured({ "index.ts": `export const index = 1;\n` }));
    await commit("feat: base");

    const red = await script("complexity/unused.ts");
    expect(red.text).toContain("unused: no knip configuration names entry files");
    expect(red.exitCode).toBe(1);
  },
  120_000,
);

test(
  "checks-lint runs the gate over the working tree, red on an added dead file and green once it is gone",
  async () => {
    const { dir, write, commit, lint } = await open({
      ...lintWiring(),
      "knip.json": JSON.stringify({ entry: ["widget.ts"], include: ["files"] }),
      "widget.ts": `export const widget = 42;\n`,
    });
    await commit("feat: base");

    const green = await lint();
    expect(green.text).toContain("checks-lint: 10 gate(s) pass");
    expect(green.exitCode).toBe(0);

    await write({ "dead.ts": `export const dead = 1;\n` });
    await commit("feat: dead");
    const red = await lint();
    expect(red.text).toContain("1 of 10 gate(s) failed: checks-unused");
    expect(red.text).toContain("unused: 1 unreferenced file(s):\n  dead.ts");
    expect(red.exitCode).toBe(1);

    await $`rm dead.ts && git add -A`.cwd(dir).quiet();
    await commit("refactor: drop the dead file");
    const clean = await lint();
    expect(clean.text).toContain("checks-lint: 10 gate(s) pass");
    expect(clean.exitCode).toBe(0);
  },
  180_000,
);
