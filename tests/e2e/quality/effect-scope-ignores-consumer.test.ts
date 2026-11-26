import { expect, test } from "bun:test";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { CHECKOUT } from "../lib/fixture-repo.ts";
import { SCOPED, UNSCOPED, ASYNC_PLANT, ASYNC_DIAGNOSTIC, scopeConsumer } from "../lib/effect-scope-consumer.ts";

const { tree, consumer, diagnostics, scopeGate, expectAsyncPaths } = scopeConsumer("checks-effect-scope-ignores-");

test("slash-less directory and wildcard ignores do not diagnose skipped files or swallow sibling names", async () => {
  for (const source of ["gitignore", "ignorePatterns"]) {
    await consumer();
    const ignores = ["scripts/generated", "coverage", "scripts/repos/*"];
    await tree.put(".gitignore", ["node_modules/", ...(source === "gitignore" ? ignores : [])].join("\n") + "\n");
    expect((await tree.run("git", ["add", ".gitignore"])).exitCode).toBe(0);
    await tree.put("oxlint.config.ts", `import { defineConfig } from "@avi2dg/checks/oxlint";
export default defineConfig({ effect: { files: ["scripts/**/*.ts"] }, ignorePatterns: ${JSON.stringify(source === "ignorePatterns" ? ignores : [])} });
`);
    const active = ["scripts/a.ts", "scripts/generatedFile.ts", "scripts/coverageFile.ts"];
    for (const file of [...active, "scripts/generated/client.ts", "scripts/coverage/plant.ts", "scripts/repos/vendor/client.ts"]) await tree.put(file, ASYNC_PLANT);
    expect((await scopeGate()).exitCode).toBe(0);
    await tree.put("scripts/generated/new.ts", ASYNC_PLANT);
    expect((await scopeGate("--check")).exitCode).toBe(0);
    await expectAsyncPaths(active);
  }
}, 180_000);

test("unrelated unsupported ignores pass without accepting a negation of a scoped TypeScript path", async () => {
  for (const source of ["gitignore", "ignorePatterns"]) {
    await consumer();
    const unrelated = [".vscode/*", "!.vscode/extensions.json", "*.py[cod]", "!outside/**"];
    const configure = async (patterns: readonly string[]) => {
      await tree.put(".gitignore", ["node_modules/", ...(source === "gitignore" ? patterns : [])].join("\n") + "\n");
      expect((await tree.run("git", ["add", ".gitignore"])).exitCode).toBe(0);
      await tree.put("oxlint.config.ts", `import { defineConfig } from "@avi2dg/checks/oxlint";
export default defineConfig({ effect: { files: ["scripts/**/*.ts"] }, ignorePatterns: ${JSON.stringify(source === "ignorePatterns" ? patterns : [])} });
`);
    };
    await configure(unrelated);
    await tree.put(SCOPED, ASYNC_PLANT);
    expect((await scopeGate()).exitCode).toBe(0);
    expect((await scopeGate("--check")).exitCode).toBe(0);
    await expectAsyncPaths([SCOPED]);
    for (const refused of ["!scripts/*.ts", "scripts/[ab]/*.cts", "scripts/\\*.tsx", "!keep/", "!scripts/vendor.lib", "!.vitepress"]) {
      await configure([...unrelated, refused]);
      for (const args of [[], ["--check"]]) {
        const result = await scopeGate(...args);
        expect(result.exitCode).toBe(2);
        expect(result.text).toContain(JSON.stringify(refused));
      }
    }
  }
}, 180_000);

type ViteSource = "root" | "nested" | "ignorePatterns";

const VITE_IGNORES = [".vscode/*", "!.vscode/extensions.json"];

async function viteConsumer(source: ViteSource): Promise<string> {
  await consumer();
  const prefix = source === "nested" ? "scripts/" : "";
  const ignoreFiles = source === "nested" ? [".gitignore", "scripts/.gitignore"] : [".gitignore"];
  const lines = VITE_IGNORES.join("\n") + "\n";
  await tree.put(".gitignore", "node_modules/\n" + (source === "root" ? lines : ""));
  if (source === "nested") await tree.put("scripts/.gitignore", lines);
  const file = `${prefix}.vscode/extensions.json`;
  await tree.put(file, "{}\n");
  expect((await tree.run("git", ["add", ...ignoreFiles, file])).exitCode).toBe(0);
  await tree.put("oxlint.config.ts", `import { defineConfig } from "@avi2dg/checks/oxlint";
export default defineConfig({ effect: true, ignorePatterns: ${JSON.stringify(source === "ignorePatterns" ? VITE_IGNORES : [])} });
`);
  await tree.put(SCOPED, ASYNC_PLANT);
  await tree.put(UNSCOPED, ASYNC_PLANT);
  return file;
}

async function expectScopeRefused(...texts: readonly string[]): Promise<void> {
  for (const args of [[], ["--check"]]) {
    const refused = await scopeGate(...args);
    expect(refused.exitCode).toBe(2);
    for (const text of texts) expect(refused.text).toContain(text);
  }
}

test("default Effect scope does not refuse Vite negations of tracked non-TypeScript files", async () => {
  for (const source of ["root", "nested", "ignorePatterns"] as const) {
    const file = await viteConsumer(source);
    expect((await tree.run(process.execPath, [join(CHECKOUT, "src", "delivery", "setup.ts")])).exitCode).toBe(0);
    expect((await scopeGate()).exitCode).toBe(0);
    expect((await scopeGate("--check")).exitCode).toBe(0);
    await expectAsyncPaths([SCOPED]);
    await rm(join(tree.dir, file));
    await expectScopeRefused(`missing tracked file ${file}`, "restore that file or remove the negation");
    await tree.put(`${file}/plant.ts`, ASYNC_PLANT);
    await expectScopeRefused();
    expect((await tree.run("git", ["add", "-f", file])).exitCode).toBe(0);
    await expectScopeRefused();
  }
}, 180_000);

test("default Effect scope does not accept untracked files, TypeScript files, or recursive basename negations", async () => {
  for (const leaf of ["extensions.json", "plant.ts", "plant.tsx", "plant.mts", "plant.cts", "plant.d.ts", "recursive.json"]) {
    await consumer();
    const negated = leaf === "recursive.json" ? leaf : `.vscode/${leaf}`;
    await tree.put(".gitignore", `node_modules/\n.vscode/*\n!${negated}\n`);
    const file = `.vscode/${leaf}`;
    await tree.put(file, "{}\n");
    expect((await tree.run("git", ["add", ".gitignore"])).exitCode).toBe(0);
    if (leaf !== "extensions.json") expect((await tree.run("git", ["add", "-f", file])).exitCode).toBe(0);
    if (leaf === "recursive.json") {
      await tree.put(leaf, "{}\n");
      expect((await tree.run("git", ["add", leaf])).exitCode).toBe(0);
    }
    await tree.put("oxlint.config.ts", 'import { defineConfig } from "@avi2dg/checks/oxlint";\nexport default defineConfig({ effect: true });\n');
    for (const args of [[], ["--check"]]) {
      const refused = await scopeGate(...args);
      expect(refused.exitCode).toBe(2);
      expect(refused.text).toContain(JSON.stringify(`!${negated}`));
    }
  }
}, 180_000);

test("info/exclude does not change scope while untracked and tracked nested ignores both apply", async () => {
  await consumer();
  await tree.put(".gitignore", "node_modules/\n");
  await tree.put("scripts/tracked/.gitignore", "ignored/\n");
  expect((await tree.run("git", ["add", ".gitignore", "scripts/tracked/.gitignore"])).exitCode).toBe(0);
  for (const file of [SCOPED, "scripts/local/a.ts", "scripts/untracked/a.ts", "scripts/tracked/ignored/a.ts"]) await tree.put(file, ASYNC_PLANT);
  expect((await scopeGate()).exitCode).toBe(0);
  const before = await readFile(join(tree.dir, "tsconfig.json"), "utf8");
  await tree.put(".git/info/exclude", "scripts/local/\n");
  expect((await scopeGate("--check")).exitCode).toBe(0);
  expect((await scopeGate()).exitCode).toBe(0);
  expect(await readFile(join(tree.dir, "tsconfig.json"), "utf8")).toBe(before);
  await tree.put("scripts/untracked/.gitignore", "a.ts\n");
  expect((await scopeGate("--check")).exitCode).toBe(1);
  expect((await scopeGate()).exitCode).toBe(0);
  expect((await scopeGate("--check")).exitCode).toBe(0);
  const diagnosed = await diagnostics();
  for (const file of [SCOPED, "scripts/local/a.ts"]) expect(diagnosed.get(file)).toContain(ASYNC_DIAGNOSTIC);
  for (const file of ["scripts/tracked/ignored/a.ts", "scripts/untracked/a.ts"]) expect(diagnosed.get(file) ?? []).not.toContain(ASYNC_DIAGNOSTIC);
}, 180_000);
