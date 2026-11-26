import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { KIT_BIN } from "../lib/consumer-tree.ts";
import { ASYNC_DIAGNOSTIC, ASYNC_PLANT, ASYNC_RULE, SCOPED, UNSCOPED, scopeConsumer } from "../lib/effect-scope-consumer.ts";

const { tree, consumer, oxlint, diagnostics, scopeGate, expectAsyncPaths } = scopeConsumer("checks-effect-scope-globs-");
const NON_ASCII = "scripts/é.ts";
const SHARED = "anyUnknownInErrorContext";

function configure(files: readonly string[], ignorePatterns: readonly string[] = [], excludeFiles: readonly string[] = []) {
  const config = { effect: { files, excludeFiles }, ignorePatterns };
  return tree.put("oxlint.config.ts", `import { defineConfig } from "@avi2dg/checks/oxlint";
export default defineConfig(${JSON.stringify(config)});
`);
}

async function expectRefusal(pattern: string): Promise<void> {
  const tsconfig = join(tree.dir, "tsconfig.json");
  const before = await readFile(tsconfig, "utf8");
  for (const run of [
    () => scopeGate("--check"),
    () => scopeGate(),
    () => tree.run(join(KIT_BIN, "checks-setup"), []),
  ]) {
    const refused = await run();
    expect(refused.exitCode).toBe(2);
    expect(refused.text).toContain(pattern);
    expect(refused.text).toContain("literal");
    expect(await readFile(tsconfig, "utf8")).toBe(before);
  }
}

test("the installed gate and setup do not certify a basename question mark that selects a UTF-8 path only in tsgo", async () => {
  await consumer();
  await configure(["?.ts"]);
  await tree.put("scripts/a.ts", ASYNC_PLANT);
  await tree.put(UNSCOPED, ASYNC_PLANT);
  expect((await scopeGate()).exitCode).toBe(0);
  await expectAsyncPaths(["scripts/a.ts"]);

  await tree.put(NON_ASCII, ASYNC_PLANT);
  const { linted } = await oxlint([]);
  expect(linted.get(NON_ASCII) ?? []).not.toContain(ASYNC_RULE);
  expect((await diagnostics()).get(NON_ASCII)).toContain(SHARED);
  await expectRefusal("?.ts");
}, 180_000);

test.each([".gitignore", "ignorePatterns"])("%s question marks do not make setup and the gate certify a Unicode file excluded only in tsgo", async (source) => {
  await consumer();
  const pattern = "scripts/?.ts";
  await configure(["scripts/**/*.ts"], source === "ignorePatterns" ? [pattern] : []);
  if (source === ".gitignore") await tree.put(".gitignore", `node_modules/\n${pattern}\n`);
  await tree.put("scripts/a.ts", ASYNC_PLANT);
  await tree.put(SCOPED, ASYNC_PLANT);
  await tree.put(UNSCOPED, ASYNC_PLANT);
  expect((await scopeGate()).exitCode).toBe(0);
  await expectAsyncPaths([SCOPED]);

  await tree.put(NON_ASCII, ASYNC_PLANT);
  expect((await oxlint([])).linted.get(NON_ASCII)).toContain(ASYNC_RULE);
  expect((await diagnostics()).get(NON_ASCII)).toContain(SHARED);
  await expectRefusal(pattern);
}, 180_000);

test("a basename glob cannot certify newly added files under tsgo's implicit dependency directories", async () => {
  await consumer();
  await configure(["*.ts"]);
  await tree.put(SCOPED, ASYNC_PLANT);
  await tree.put(UNSCOPED, ASYNC_PLANT);
  expect((await scopeGate()).exitCode).toBe(0);

  const dependency = "scripts/bower_components/local.ts";
  await tree.put(dependency, ASYNC_PLANT);
  expect((await oxlint([])).linted.get(dependency)).toContain(ASYNC_RULE);
  expect((await diagnostics()).get(dependency)).not.toContain(ASYNC_DIAGNOSTIC);
  const refused = await scopeGate("--check");
  expect(refused.exitCode).toBe(2);
  expect(refused.text).toContain(dependency);
  expect(refused.text).toContain("explicitly in files");

  await configure(["*.ts", dependency]);
  expect((await scopeGate()).exitCode).toBe(0);
  expect((await scopeGate("--check")).exitCode).toBe(0);
  await expectAsyncPaths([SCOPED, UNSCOPED, dependency]);
}, 180_000);

test("a basename glob cannot certify a minified TypeScript file oxlint skips", async () => {
  await consumer();
  await configure(["*.ts"]);
  await tree.put(SCOPED, ASYNC_PLANT);
  await tree.put(UNSCOPED, ASYNC_PLANT);
  expect((await scopeGate()).exitCode).toBe(0);

  const minified = "scripts/generated.min.ts";
  await tree.put(minified, ASYNC_PLANT);
  expect((await oxlint([])).linted.get(minified) ?? []).not.toContain(ASYNC_RULE);
  expect((await diagnostics()).get(minified)).toContain(ASYNC_DIAGNOSTIC);
  const refused = await scopeGate("--check");
  expect(refused.exitCode).toBe(2);
  expect(refused.text).toContain(minified);
  expect(refused.text).toContain("excludeFiles");

  await configure(["*.ts"], [], [minified]);
  expect((await scopeGate()).exitCode).toBe(0);
  expect((await scopeGate("--check")).exitCode).toBe(0);
  await expectAsyncPaths([SCOPED, UNSCOPED]);
  expect((await diagnostics()).get(minified)).toContain(SHARED);
}, 180_000);

test.each([".gitignore", "ignorePatterns"])("%s directory-only globstar does not suppress direct file children", async (source) => {
  await consumer();
  const pattern = "scripts/generated/**/";
  await configure(["scripts/**/*.ts"], source === "ignorePatterns" ? [pattern] : []);
  if (source === ".gitignore") await tree.put(".gitignore", `node_modules/\n${pattern}\n`);
  const direct = "scripts/generated/keep.ts";
  const deep = "scripts/generated/deep/skip.ts";
  for (const file of [SCOPED, direct, deep, UNSCOPED]) await tree.put(file, ASYNC_PLANT);
  expect((await scopeGate()).exitCode).toBe(0);
  expect((await scopeGate("--check")).exitCode).toBe(0);
  await expectAsyncPaths([SCOPED, direct]);
  expect((await diagnostics()).get(deep)).toContain(SHARED);
}, 180_000);

test("the first .gitignore pattern is not lost when the file starts with a byte order mark", async () => {
  await consumer();
  const ignored = "scripts/skip.ts";
  await tree.put(".gitignore", `\uFEFF${ignored}\nnode_modules/\n`);
  for (const file of [SCOPED, ignored, UNSCOPED]) await tree.put(file, ASYNC_PLANT);
  expect((await scopeGate()).exitCode).toBe(0);
  expect((await scopeGate("--check")).exitCode).toBe(0);
  await expectAsyncPaths([SCOPED]);
  expect((await diagnostics()).get(ignored)).toContain(SHARED);
}, 180_000);
