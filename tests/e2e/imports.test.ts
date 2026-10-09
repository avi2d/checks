import { expect, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { CHECKOUT, fixtureRepos, type FixtureRepo } from "./lib/fixture-repo.ts";

const open = fixtureRepos("checks-imports-");

const TREE: Readonly<Record<string, string>> = {
  "package.json": JSON.stringify({ name: "checks-imports-fixture", type: "module", devDependencies: { "fake-dev": "1.0.0" } }),
  "src/index.ts": `export const answer: number = 42;\n`,
  "tests/unit/index.test.ts": `import { answer } from "../../src/index.ts";\nexport const checked: number = answer;\n`,
};

async function repository(files: Readonly<Record<string, string>> = {}): Promise<FixtureRepo> {
  const repo = await open({ ...TREE, ...files });
  await mkdir(join(repo.dir, "node_modules", "fake-dev"), { recursive: true });
  await writeFile(join(repo.dir, "node_modules", "fake-dev", "package.json"), JSON.stringify({ name: "fake-dev", version: "1.0.0", main: "index.js" }));
  await writeFile(join(repo.dir, "node_modules", "fake-dev", "index.js"), "export const dev = 1;\n");
  await repo.commit("feat: tree");
  return repo;
}

const imports = (repo: FixtureRepo) => repo.script("dependencies/imports.ts");

test("with no config of its own a repository is cruised against the kit's defaults, red on an orphan and green once it is imported", async () => {
  const repo = await repository({ "src/lonely.ts": `export const lonely: number = 1;\n` });
  const red = await imports(repo);
  expect(red.text).toContain("cruised against the kit's defaults");
  expect(red.text).toContain("error no-orphans: src/lonely.ts");
  expect(red.exitCode).toBe(1);

  await repo.write({ "src/index.ts": `import { lonely } from "./lonely.ts";\nexport const answer: number = lonely;\n` });
  await repo.commit("fix: import it");
  const green = await imports(repo);
  expect(green.text).toContain("3 module(s) cruised against the kit's defaults, no violation");
  expect(green.exitCode).toBe(0);
}, 60_000);

test("the defaults let tests/ import a dev dependency and refuse it in shipped source", async () => {
  const repo = await repository({ "tests/lib/dev.ts": `import { dev } from "fake-dev";\nexport const viaDev: number = dev;\n`, "tests/unit/dev.test.ts": `import { viaDev } from "../lib/dev.ts";\nexport const seen: number = viaDev;\n` });
  expect((await imports(repo)).exitCode).toBe(0);

  await repo.write({ "src/index.ts": `import { dev } from "fake-dev";\nexport const answer: number = dev;\n` });
  await repo.commit("feat: ship the dev dependency");
  const red = await imports(repo);
  expect(red.text).toContain("error not-to-dev-dep: src/index.ts → node_modules/fake-dev/index.js");
  expect(red.exitCode).toBe(1);
}, 60_000);

test("a repository's dependency-cruiser.config.ts names its own entry points through the kit's builder", async () => {
  const config = `import { defineConfig } from "${CHECKOUT}/dist/presets/dependency-cruiser.js";\n\nexport default defineConfig({ orphans: ["^src/bin[.]ts$"] });\n`;
  const repo = await repository({ "src/bin.ts": `export const bin: number = 1;\n`, "dependency-cruiser.config.ts": config });
  const green = await imports(repo);
  expect(green.text).toContain("cruised against dependency-cruiser.config.ts, no violation");
  expect(green.exitCode).toBe(0);
}, 60_000);

test("a .dependency-cruiser.cjs extending the shipped base by path is cruised in place of the defaults", async () => {
  const config = `module.exports = { extends: ${JSON.stringify(join(CHECKOUT, "dependency-cruiser.config.js"))} };\n`;
  const repo = await repository({ "src/lonely.ts": `export const lonely: number = 1;\n`, ".dependency-cruiser.cjs": config });
  const red = await imports(repo);
  expect(red.text).toContain("cruised against .dependency-cruiser.cjs");
  expect(red.text).toContain("error no-orphans: src/lonely.ts");
  expect(red.exitCode).toBe(1);
}, 60_000);

test("in a repository that depends on astro the defaults pass a module only an .astro page imports, and its own config can turn no-orphans back on", async () => {
  const astro = JSON.stringify({ name: "checks-imports-astro", type: "module", dependencies: { astro: "5.0.0" }, devDependencies: { "fake-dev": "1.0.0" } });
  const page = `---\nimport { SITE_TITLE } from "../consts.ts";\n---\n<h1>{SITE_TITLE}</h1>\n`;
  const repo = await repository({ "package.json": astro, "src/consts.ts": `export const SITE_TITLE: string = "Site";\n`, "src/pages/index.astro": page });
  const green = await imports(repo);
  expect(green.text).toContain("cruised against the kit's defaults, no violation");
  expect(green.exitCode).toBe(0);

  const config = `import { defineConfig } from "${CHECKOUT}/dist/presets/dependency-cruiser.js";\n\nexport default defineConfig({ forbidden: [{ name: "no-orphans", severity: "error", from: { orphan: true, pathNot: ["[.]config[.]ts$", "[.]test[.]ts$"] }, to: {} }] });\n`;
  await repo.write({ "dependency-cruiser.config.ts": config });
  await repo.commit("feat: judge orphans");
  const red = await imports(repo);
  expect(red.text).toContain("error no-orphans: src/consts.ts");
  expect(red.exitCode).toBe(1);
}, 60_000);

test("a tracked file deleted without staging is left out of the cruise instead of stopping it", async () => {
  const repo = await repository({ "src/lonely.ts": `export const lonely: number = 1;\n` });
  await rm(join(repo.dir, "src", "lonely.ts"));
  const green = await imports(repo);
  expect(green.text).toContain("2 module(s) cruised against the kit's defaults, no violation");
  expect(green.exitCode).toBe(0);
}, 60_000);

test("a file with a non-ASCII name is cruised and judged by its own path", async () => {
  const repo = await repository({ "src/кот.ts": `export const cat: number = 1;\n` });
  const red = await imports(repo);
  expect(red.text).toContain("error no-orphans: src/кот.ts");
  expect(red.exitCode).toBe(1);

  await repo.write({ "src/index.ts": `import { cat } from "./кот.ts";\nexport const answer: number = cat;\n` });
  await repo.commit("fix: import it");
  const green = await imports(repo);
  expect(green.text).toContain("3 module(s) cruised against the kit's defaults, no violation");
  expect(green.exitCode).toBe(0);
}, 60_000);

test("a config dependency-cruiser cannot load leaves the gate undecided", async () => {
  const repo = await repository({ "dependency-cruiser.config.ts": `throw new Error("unreadable");\n` });
  const undecided = await imports(repo);
  expect(undecided.text).toContain("dependency-cruiser exits");
  expect(undecided.exitCode).toBe(2);
}, 60_000);
