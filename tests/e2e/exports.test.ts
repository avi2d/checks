import { expect, test } from "bun:test";
import { CHECKOUT, fixtureRepos, lintWiring } from "./lib/fixture-repo.ts";

const open = fixtureRepos("checks-exports-");

function configured(files: Readonly<Record<string, string>>): Readonly<Record<string, string>> {
  return {
    "package.json": JSON.stringify({ name: "exports-fixture", type: "module" }),
    ...files,
  };
}

function extendingBase(entry: readonly string[]): string {
  return `import base from "${CHECKOUT}/knip-base.json";\nexport default { ...base, entry: ${JSON.stringify(entry)} };\n`;
}

test(
  "red on an unused export and an unused type and green once both are gone, while an unreferenced file never fails",
  async () => {
    const { write, commit, script } = await open(
      configured({
        "knip.config.ts": extendingBase(["src/index.ts"]),
        "src/index.ts": `import { used } from "./used.ts";\n\nexport const index = used;\n`,
        "src/used.ts": `export const used = 1;\nexport const unusedExport = 2;\nexport type UnusedOptions = { readonly flag: boolean };\n`,
        "src/dead.ts": `export const dead = 1;\n`,
      }),
    );
    await commit("feat: base");

    const red = await script("complexity/exports.ts");
    expect(red.text).toBe(
      "exports: 2 unused export(s) not in exports-baseline.json:\n  src/used.ts: unusedExport (export)\n  src/used.ts: UnusedOptions (type)\n",
    );
    expect(red.text).not.toContain("dead.ts");
    expect(red.exitCode).toBe(1);

    await write({ "src/used.ts": `export const used = 1;\n` });
    const green = await script("complexity/exports.ts");
    expect(green.text).toBe("exports: no unused exports or types\n");
    expect(green.exitCode).toBe(0);
  },
  120_000,
);

test(
  "a baseline holds each listed symbol and refuses an entry Knip no longer reports",
  async () => {
    const held = [
      { file: "src/used.ts", kind: "export", name: "unusedExport" },
      { file: "src/used.ts", kind: "type", name: "UnusedOptions" },
    ];
    const { write, commit, script } = await open(
      configured({
        "knip.config.ts": extendingBase(["src/index.ts"]),
        "exports-baseline.json": JSON.stringify(held),
        "src/index.ts": `import { used } from "./used.ts";\n\nexport const index = used;\n`,
        "src/used.ts": `export const used = 1;\nexport const unusedExport = 2;\nexport type UnusedOptions = { readonly flag: boolean };\n`,
      }),
    );
    await commit("feat: base");

    const passing = await script("complexity/exports.ts");
    expect(passing.text).toBe("exports: 2 unused export(s) in exports-baseline.json, and no new ones\n");
    expect(passing.exitCode).toBe(0);

    await write({ "src/used.ts": `export const used = 1;\n` });
    const stale = await script("complexity/exports.ts");
    expect(stale.text).toBe(
      "exports: 2 exports-baseline.json export(s) no longer reported, remove them:\n  src/used.ts: unusedExport (export)\n  src/used.ts: UnusedOptions (type)\n",
    );
    expect(stale.exitCode).toBe(1);

    await write({ "exports-baseline.json": "[]\n" });
    const clean = await script("complexity/exports.ts");
    expect(clean.text).toBe("exports: no unused exports or types\n");
    expect(clean.exitCode).toBe(0);
  },
  120_000,
);

test(
  "fails when no TypeScript source is tracked",
  async () => {
    const untracked = await open(configured({ "knip.json": JSON.stringify({ entry: ["index.ts"] }) }));
    await untracked.write({ "index.ts": `export const index = 1;\n` });
    const empty = await untracked.script("complexity/exports.ts");
    expect(empty.text).toContain("exports: no tracked .ts or .tsx files to scan");
    expect(empty.exitCode).toBe(2);
  },
  120_000,
);

test(
  "fails when the repository holds no knip configuration",
  async () => {
    const { commit, script } = await open(configured({ "index.ts": `export const index = 1;\n` }));
    await commit("feat: base");

    const red = await script("complexity/exports.ts");
    expect(red.text).toContain("exports: no knip configuration names entry files");
    expect(red.exitCode).toBe(1);
  },
  120_000,
);

test(
  "judges exports even when the knip configuration narrows include or excludes them",
  async () => {
    for (const narrowed of [{ include: ["files"] }, { exclude: ["exports", "types"] }]) {
      const { commit, script } = await open(
        configured({
          "knip.json": JSON.stringify({ entry: ["index.ts"], ...narrowed }),
          "index.ts": `import { used } from "./used.ts";\n\nexport const index = used;\n`,
          "used.ts": `export const used = 1;\nexport const unusedExport = 2;\n`,
        }),
      );
      await commit("feat: base");

      const red = await script("complexity/exports.ts");
      expect(red.text).toBe("exports: 1 unused export(s) not in exports-baseline.json:\n  used.ts: unusedExport (export)\n");
      expect(red.exitCode).toBe(1);
    }
  },
  120_000,
);

test(
  "a configuration that turns the exports and types rules off silences those symbols",
  async () => {
    const { commit, script } = await open(
      configured({
        "knip.json": JSON.stringify({ entry: ["index.ts"], rules: { exports: "off", types: "off" } }),
        "index.ts": `import { used } from "./used.ts";\n\nexport const index = used;\n`,
        "used.ts": `export const used = 1;\nexport const unusedExport = 2;\n`,
      }),
    );
    await commit("feat: base");

    const passing = await script("complexity/exports.ts");
    expect(passing.text).toBe("exports: no unused exports or types\n");
    expect(passing.exitCode).toBe(0);
  },
  120_000,
);

test(
  "checks-lint runs the gate over the working tree, red on an added unused export and green once it is used",
  async () => {
    const { write, commit, lint } = await open({
      ...lintWiring(),
      "knip.json": JSON.stringify({ entry: ["widget.ts"], include: ["files"] }),
      "widget.ts": `import { used } from "./used.ts";\n\nexport const widget = used;\n`,
      "used.ts": `export const used = 1;\nexport const unusedExport = 2;\n`,
    });
    await commit("feat: base");

    const red = await lint();
    expect(red.text).toContain("1 of 11 gate(s) failed: checks-exports");
    expect(red.text).toContain("exports: 1 unused export(s) not in exports-baseline.json:\n  used.ts: unusedExport (export)");
    expect(red.exitCode).toBe(1);

    await write({ "used.ts": `export const used = 1;\n` });
    await commit("refactor: use every export");
    const clean = await lint();
    expect(clean.text).toContain("checks-lint: 11 gate(s) pass");
    expect(clean.exitCode).toBe(0);
  },
  180_000,
);
