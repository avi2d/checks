import { $ } from "bun";
import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { withoutPullRequestEvent } from "../lib/env.ts";
import { CHECKOUT, fixtureRepos, lintWiring, ran, type Ran } from "./lib/fixture-repo.ts";

const open = fixtureRepos("checks-exports-");
const GATE = "complexity/exports.ts";

function configured(files: Readonly<Record<string, string>>): Readonly<Record<string, string>> {
  return {
    "package.json": JSON.stringify({ name: "exports-fixture", type: "module" }),
    ...files,
  };
}

function kitConfig(entry: readonly string[]): string {
  return `import { defineConfig } from "${CHECKOUT}/dist/presets/knip.js";\nexport default defineConfig({ entry: ${JSON.stringify(entry)} });\n`;
}

test(
  "red on an unused export and an unused type and green once both are gone, while an unreferenced file never fails",
  async () => {
    const { write, commit, script } = await open(
      configured({
        "knip.config.ts": kitConfig(["src/index.ts"]),
        "src/index.ts": `import { used } from "./used.ts";\n\nexport const index = used;\n`,
        "src/used.ts": `export const used = 1;\nexport const unusedExport = 2;\nexport type UnusedOptions = { readonly flag: boolean };\n`,
        "src/dead.ts": `export const dead = 1;\n`,
      }),
    );
    const base = await commit("feat: base");

    const red = await script(GATE, base, "HEAD");
    expect(red.text).toBe(
      "exports: 2 unused export(s) not in exports-baseline.json:\n  src/used.ts: unusedExport (export)\n  src/used.ts: UnusedOptions (type)\n",
    );
    expect(red.text).not.toContain("dead.ts");
    expect(red.exitCode).toBe(1);

    await write({ "src/used.ts": `export const used = 1;\n` });
    const green = await script(GATE, base, "HEAD");
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
        "knip.config.ts": kitConfig(["src/index.ts"]),
        "exports-baseline.json": JSON.stringify(held),
        "src/index.ts": `import { used } from "./used.ts";\n\nexport const index = used;\n`,
        "src/used.ts": `export const used = 1;\nexport const unusedExport = 2;\nexport type UnusedOptions = { readonly flag: boolean };\n`,
      }),
    );
    const base = await commit("feat: base");

    const passing = await script(GATE, base, "HEAD");
    expect(passing.text).toBe("exports: 2 unused export(s) in exports-baseline.json, and no new ones\n");
    expect(passing.exitCode).toBe(0);

    await write({ "src/used.ts": `export const used = 1;\n` });
    const stale = await script(GATE, base, "HEAD");
    expect(stale.text).toBe(
      "exports: 2 exports-baseline.json export(s) no longer reported, remove them:\n  src/used.ts: unusedExport (export)\n  src/used.ts: UnusedOptions (type)\n",
    );
    expect(stale.exitCode).toBe(1);

    await write({ "exports-baseline.json": "[]\n" });
    const clean = await script(GATE, base, "HEAD");
    expect(clean.text).toBe("exports: no unused exports or types\n");
    expect(clean.exitCode).toBe(0);
  },
  120_000,
);

test(
  "refuses a new dead export listed with its entry, from either end of the range, while accepting one the base already left unused",
  async () => {
    const { write, commit, script } = await open(
      configured({
        "knip.config.ts": kitConfig(["src/index.ts"]),
        "src/index.ts": `import { used } from "./used.ts";\n\nexport const index = used;\n`,
        "src/used.ts": `export const used = 1;\nexport const unusedExport = 2;\n`,
      }),
    );
    const base = await commit("feat: base");

    await write({
      "exports-baseline.json": JSON.stringify([
        { file: "src/used.ts", kind: "export", name: "foo" },
        { file: "src/used.ts", kind: "export", name: "unusedExport" },
      ]),
      "src/used.ts": `export const used = 1;\nexport const unusedExport = 2;\nexport const foo = 3;\n`,
    });
    const added = await commit("feat: add an unused export and list it");

    const expected =
      "exports: 1 exports-baseline.json export(s) the range adds that its base did not leave unused, remove the export instead:\n  src/used.ts: foo (export)\n";
    const range = await script(GATE, base, added);
    expect(range.text).toBe(expected);
    expect(range.exitCode).toBe(1);
    const tip = await script(GATE, added);
    expect(tip.text).toBe(expected);
    expect(tip.exitCode).toBe(1);
  },
  120_000,
);

test(
  "refuses an export the range stops importing and lists in the baseline",
  async () => {
    const { write, commit, script } = await open(
      configured({
        "knip.config.ts": kitConfig(["src/index.ts"]),
        "src/index.ts": `import { helper, used } from "./used.ts";\n\nexport const index = used + helper;\n`,
        "src/used.ts": `export const used = 1;\nexport const helper = 2;\n`,
      }),
    );
    const base = await commit("feat: base");

    await write({
      "exports-baseline.json": JSON.stringify([{ file: "src/used.ts", kind: "export", name: "helper" }]),
      "src/index.ts": `import { used } from "./used.ts";\n\nexport const index = used;\n`,
    });
    await commit("refactor: stop importing helper and list it");

    const red = await script(GATE, base, "HEAD");
    expect(red.text).toBe(
      "exports: 1 exports-baseline.json export(s) the range adds that its base did not leave unused, remove the export instead:\n  src/used.ts: helper (export)\n",
    );
    expect(red.exitCode).toBe(1);
  },
  120_000,
);

const LEGACY_A = { file: "legacy.ts", kind: "export", name: "legacyA" };
const LEGACY_Z = { file: "legacy.ts", kind: "export", name: "legacyZ" };

function baselineLines(entries: readonly object[]): string {
  return `[\n${entries.map((entry) => `  ${JSON.stringify(entry)}`).join(",\n")}\n]\n`;
}

async function pullRequestMergeCheckout(pr: Readonly<Record<string, string>>): Promise<Ran> {
  const { dir, write, commit } = await open({
    ...lintWiring(),
    "knip.json": JSON.stringify({ entry: ["index.ts"] }),
    "index.ts": `import { helper } from "./helper.ts";\nimport { kept } from "./legacy.ts";\nimport { used } from "./used.ts";\n\nexport const index = used + helper + kept;\n`,
    "used.ts": `export const used = 1;\n`,
    "helper.ts": `export const helper = 1;\n`,
    "legacy.ts": `export const kept = 0;\nexport const legacyA = 1;\nexport const legacyZ = 2;\n`,
    "exports-baseline.json": baselineLines([LEGACY_A, LEGACY_Z]),
  });
  await commit("feat: base");
  await $`git checkout -q -b pr`.cwd(dir);
  await write(pr);
  const prHead = await commit("feat: change the pull request");

  await $`git checkout -q main`.cwd(dir);
  await write({ "helper.ts": `export const helper = 1;\nexport const seeded = 2;\n` });
  await commit("feat: add an export nothing imports");
  await write({ "exports-baseline.json": baselineLines([{ file: "helper.ts", kind: "export", name: "seeded" }, LEGACY_A, LEGACY_Z]) });
  await commit("chore: seed the exports baseline");
  await $`git update-ref refs/remotes/origin/main main && git checkout -q --detach main`.cwd(dir);
  await $`git -c user.name=GitHub -c user.email=noreply@github.com merge -q --no-ff --no-gpg-sign -m merge pr`.cwd(dir).quiet();

  const event = join(dir, "event.json");
  await writeFile(event, JSON.stringify({ pull_request: { number: 7, base: { ref: "main" }, head: { sha: prHead } } }));
  return ran(
    $`bun ${join(CHECKOUT, "src", "core", "lint.ts")}`.cwd(dir).env({
      ...withoutPullRequestEvent(),
      PATH: `${join(CHECKOUT, "node_modules", ".bin")}:${process.env["PATH"] ?? ""}`,
      GITHUB_EVENT_NAME: "pull_request",
      GITHUB_EVENT_PATH: event,
    }),
  );
}

test(
  "checks-lint on a pull request merge checkout holds a symbol the base branch seeded that the pull request never touched",
  async () => {
    const green = await pullRequestMergeCheckout({
      "index.ts": `import { helper } from "./helper.ts";\nimport { kept } from "./legacy.ts";\nimport { used } from "./used.ts";\n\nexport const index = used + helper + kept + 1;\n`,
    });
    expect(green.text).toContain("exports: 3 unused export(s) in exports-baseline.json, and no new ones");
    expect(green.text).toContain("checks-lint: 13 gate(s) pass");
    expect(green.exitCode).toBe(0);
  },
  180_000,
);

test(
  "checks-lint on a pull request merge checkout refuses a dead export the pull request adds with its entry",
  async () => {
    const red = await pullRequestMergeCheckout({
      "used.ts": `export const used = 1;\nexport const fresh = 3;\n`,
      "exports-baseline.json": baselineLines([LEGACY_A, { file: "used.ts", kind: "export", name: "fresh" }, LEGACY_Z]),
    });
    expect(red.text).toContain(
      "exports: 1 exports-baseline.json export(s) the range adds that its base did not leave unused, remove the export instead:\n  used.ts: fresh (export)\n",
    );
    expect(red.text).toContain("1 of 13 gate(s) failed: checks-exports");
    expect(red.exitCode).toBe(1);
  },
  180_000,
);

test(
  "--write seeds the baseline with every reported symbol, which the seeding range and the next range both hold",
  async () => {
    const { dir, write, commit, script } = await open(
      configured({
        ".gitignore": "node_modules\n",
        "knip.config.ts": `import { defineConfig } from "@avi2dg/checks/knip";\nexport default defineConfig({ entry: ["src/index.ts"] });\n`,
        "src/index.ts": `import { used } from "./used.ts";\n\nexport const index = used;\n`,
        "src/used.ts": `export const used = 1;\nexport const unusedExport = 2;\nexport type UnusedOptions = { readonly flag: boolean };\n`,
      }),
    );
    await mkdir(join(dir, "node_modules", "@avi2dg"), { recursive: true });
    await symlink(CHECKOUT, join(dir, "node_modules", "@avi2dg", "checks"));
    const base = await commit("feat: base");

    const seeded = await script(GATE, "--write");
    expect(seeded.text).toBe("exports: wrote 2 unused export(s) to exports-baseline.json\n");
    expect(seeded.exitCode).toBe(0);
    expect(JSON.parse(await readFile(join(dir, "exports-baseline.json"), "utf8"))).toEqual([
      { file: "src/used.ts", kind: "export", name: "unusedExport" },
      { file: "src/used.ts", kind: "type", name: "UnusedOptions" },
    ]);
    const seeding = await commit("chore: seed the exports baseline");

    const held = "exports: 2 unused export(s) in exports-baseline.json, and no new ones\n";
    for (const refs of [[seeding], [base, seeding]]) {
      const adopted = await script(GATE, ...refs);
      expect(adopted.text).toBe(held);
      expect(adopted.exitCode).toBe(0);
    }

    await write({ "notes.md": "# notes\n" });
    await commit("docs: add notes");
    const next = await script(GATE, seeding, "HEAD");
    expect(next.text).toBe(held);
    expect(next.exitCode).toBe(0);
  },
  120_000,
);

test(
  "fails when no TypeScript source is tracked",
  async () => {
    const untracked = await open(configured({ "knip.json": JSON.stringify({ entry: ["index.ts"] }) }));
    await untracked.write({ "index.ts": `export const index = 1;\n` });
    const empty = await untracked.script(GATE, "HEAD");
    expect(empty.text).toContain("exports: no tracked TypeScript source to scan");
    expect(empty.exitCode).toBe(2);
  },
  120_000,
);

test(
  "--write refuses to seed a baseline in a repository that tracks only Astro source",
  async () => {
    const { dir, commit, script } = await open(
      configured({
        "knip.json": JSON.stringify({ entry: ["src/pages/**/*.astro"] }),
        "src/pages/index.astro": `---\nconst { title } = Astro.props;\n---\n<h1>{title}</h1>\n`,
      }),
    );
    await commit("feat: base");

    const refused = await script(GATE, "--write");
    expect(refused.text).toContain("exports: no tracked TypeScript source to scan");
    expect(refused.exitCode).toBe(2);
    expect(existsSync(join(dir, "exports-baseline.json"))).toBe(false);
  },
  120_000,
);

test(
  "fails when the repository holds no knip configuration",
  async () => {
    const { commit, script } = await open(configured({ "index.ts": `export const index = 1;\n` }));
    await commit("feat: base");

    const red = await script(GATE, "HEAD");
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

      const red = await script(GATE, "HEAD");
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

    const passing = await script(GATE, "HEAD");
    expect(passing.text).toBe("exports: no unused exports or types\n");
    expect(passing.exitCode).toBe(0);
  },
  120_000,
);

test(
  "checks-lint runs the gate over its range, red on an added unused export and green once it is used",
  async () => {
    const { write, commit, lint } = await open({
      ...lintWiring(),
      "knip.json": JSON.stringify({ entry: ["widget.ts"], include: ["files"] }),
      "widget.ts": `import { used } from "./used.ts";\n\nexport const widget = used;\n`,
      "used.ts": `export const used = 1;\nexport const unusedExport = 2;\n`,
    });
    await commit("feat: base");

    const red = await lint();
    expect(red.text).toContain("1 of 13 gate(s) failed: checks-exports");
    expect(red.text).toContain("exports: 1 unused export(s) not in exports-baseline.json:\n  used.ts: unusedExport (export)");
    expect(red.exitCode).toBe(1);

    await write({ "used.ts": `export const used = 1;\n` });
    await commit("refactor: use every export");
    const clean = await lint();
    expect(clean.text).toContain("checks-lint: 13 gate(s) pass");
    expect(clean.exitCode).toBe(0);
  },
  180_000,
);
