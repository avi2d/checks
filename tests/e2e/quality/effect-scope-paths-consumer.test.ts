import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { SCOPED, UNSCOPED, SCOPE_SERVICE, KIT_SERVICE, PLANT, ASYNC_PLANT, ASYNC_RULE, ASYNC_DIAGNOSTIC, scopeConsumer } from "../lib/effect-scope-consumer.ts";

const { tree, consumer, oxlint, diagnostics, scopeGate, expectAsyncPaths } = scopeConsumer("checks-effect-scope-paths-");

test("scope check does not certify brace or basename paths or paths ignored only by oxlint", async () => {
  const cases = [
    { scope: '{ files: ["scripts/{a,b}.ts"] }', extra: "", ignore: "", refused: "scripts/{a,b}.ts" },
    { scope: '{ files: ["scripts/**/*.ts"], excludeFiles: ["scripts/{a,b}.ts"] }', extra: "", ignore: "", refused: "scripts/{a,b}.ts" },
    { scope: '{ files: ["a.ts"] }', extra: "", ignore: "" },
    { scope: '{ files: ["scripts/**/*.ts"] }', extra: ', ignorePatterns: ["scripts/b.ts"]', ignore: "" },
    { scope: '{ files: ["scripts/**/*.ts"] }', extra: "", ignore: "scripts/b.ts\n" },
  ] as const;
  for (const entry of cases) {
    const { scope, extra, ignore } = entry;
    await consumer();
    await tree.put(".gitignore", "node_modules/\n" + ignore);
    expect((await tree.run("git", ["add", ".gitignore"])).exitCode).toBe(0);
    await tree.put("oxlint.config.ts", `import { defineConfig } from "@avi2dg/checks/oxlint";
export default defineConfig({ effect: ${scope}${extra} });
`);
    for (const path of ["scripts/a.ts", "scripts/b.ts", "scripts/nested/a.ts", UNSCOPED]) await tree.put(path, ASYNC_PLANT);
    const generated = await scopeGate();
    const checked = await scopeGate("--check");
    if ("refused" in entry) {
      for (const run of [generated, checked]) {
        expect(run.exitCode).toBe(2);
        expect(run.text).toContain(entry.refused);
        expect(run.text).toContain("use separate relative globs");
      }
    } else {
      expect(generated.exitCode).toBe(0);
      expect(checked.exitCode).toBe(0);
      await expectAsyncPaths(["scripts/a.ts", "scripts/nested/a.ts"]);
      expect((await diagnostics()).get("scripts/b.ts")).toContain("anyUnknownInErrorContext");
    }
  }
}, 180_000);

test("scope generation refuses hidden includes and file exclusions that tsgo resolves differently, even for late paths", async () => {
  const cases = [
    { file: "scripts/.hidden.ts", exclude: [], repairedInclude: ["scripts/**/*.ts", "scripts/.hidden.ts"], repairedExclude: [] },
    { file: "scripts/.hidden/a.ts", exclude: [], repairedInclude: ["scripts/**/*.ts", "scripts/.hidden/a.ts"], repairedExclude: [] },
    { file: "scripts/a.ts/nested.ts", exclude: ["scripts/a.ts"], repairedInclude: ["scripts/**/*.ts"], repairedExclude: ["scripts/a.ts/**"] },
    { file: "scripts/nested/a.ts/child.ts", exclude: ["a.ts"], repairedInclude: ["scripts/**/*.ts"], repairedExclude: ["**/a.ts/**"] },
  ];
  for (const { file, exclude, repairedInclude, repairedExclude } of cases) {
    await consumer();
    const configure = (include: readonly string[], excludeFiles: readonly string[]) =>
      tree.put("oxlint.config.ts", `import { defineConfig } from "@avi2dg/checks/oxlint";
export default defineConfig({ effect: { files: ${JSON.stringify(include)}, excludeFiles: ${JSON.stringify(excludeFiles)} } });
`);
    await configure(["scripts/**/*.ts"], exclude);
    await tree.put(SCOPED, ASYNC_PLANT);
    await tree.put(UNSCOPED, ASYNC_PLANT);
    await tree.put("tsconfig.json", {
      extends: ["@avi2dg/checks/tsconfig.effect.json"],
      compilerOptions: { target: "esnext", module: "preserve", moduleResolution: "bundler", strict: true, noEmit: true, types: ["bun"] },
      files: [SCOPED, UNSCOPED, file],
    });
    expect((await scopeGate()).exitCode).toBe(0);
    await tree.put(file, ASYNC_PLANT);
    const before = await readFile(join(tree.dir, "tsconfig.json"), "utf8");
    expect((await oxlint([])).linted.get(file)).toContain(ASYNC_RULE);
    const mismatched = await diagnostics();
    expect(mismatched.get(file) ?? []).not.toContain(ASYNC_DIAGNOSTIC);
    expect(mismatched.get(UNSCOPED)).toContain("anyUnknownInErrorContext");
    for (const args of [[], ["--check"]]) {
      const refused = await scopeGate(...args);
      expect(refused.exitCode).toBe(2);
      expect(refused.text).toContain(file);
      expect(refused.text).toContain(file.includes("/.") ? "explicitly in files" : "rename that directory");
      expect(await readFile(join(tree.dir, "tsconfig.json"), "utf8")).toBe(before);
    }
    await configure(repairedInclude, repairedExclude);
    expect((await scopeGate()).exitCode).toBe(0);
    expect((await scopeGate("--check")).exitCode).toBe(0);
    await expectAsyncPaths(file.includes("/.") ? [SCOPED, file] : [SCOPED]);
    expect((await diagnostics()).get(UNSCOPED)).toContain("anyUnknownInErrorContext");
  }
}, 180_000);

test("basename file exclusions do not reject ordinary files or suppress unrelated paths", async () => {
  await consumer();
  await tree.put("oxlint.config.ts", `import { defineConfig } from "@avi2dg/checks/oxlint";
export default defineConfig({ effect: { files: ["scripts/**/*.ts"], excludeFiles: ["a.ts"] } });
`);
  for (const file of ["scripts/a.ts", "scripts/nested/a.ts", SCOPED, UNSCOPED]) await tree.put(file, ASYNC_PLANT);
  expect((await scopeGate()).exitCode).toBe(0);
  expect((await scopeGate("--check")).exitCode).toBe(0);
  await expectAsyncPaths([SCOPED]);
  expect((await diagnostics()).get(UNSCOPED)).toContain("anyUnknownInErrorContext");
}, 180_000);

test("globstar and question mark include new matches without dropping ordinary excludes", async () => {
  await consumer();
  await tree.put("oxlint.config.ts", `import { defineConfig } from "@avi2dg/checks/oxlint";
export default defineConfig({ effect: { files: ["scripts/**/task?.ts"], excludeFiles: ["scripts/host/**"] } });
`);
  for (const path of ["scripts/task1.ts", "scripts/nested/task2.ts", "scripts/host/task3.ts", "scripts/task10.ts"]) {
    await tree.put(path, ASYNC_PLANT);
  }
  expect((await scopeGate()).exitCode).toBe(0);
  await tree.put("scripts/nested/task4.ts", ASYNC_PLANT);
  expect((await scopeGate("--check")).exitCode).toBe(0);
  await expectAsyncPaths(["scripts/task1.ts", "scripts/nested/task2.ts", "scripts/nested/task4.ts"]);
}, 180_000);

test("effect-free configs do not refuse irrelevant scope paths, categories, extends, or ignore files", async () => {
  for (const config of [
    'export default {};',
    'export default { ...defineConfig({ effect: false }), extends: ["other.json"], categories: { restriction: "deny" }, overrides: [{ files: ["scripts/{a,b}.ts"], rules: { "eslint/no-debugger": "error" } }] };',
  ]) {
    await consumer();
    await tree.put("oxlint.config.ts", `import { defineConfig } from "@avi2dg/checks/oxlint";\n${config}\n`);
    await tree.put(".gitignore", "node_modules/\n!.vscode/extensions.json\n");
    await tree.put(".eslintignore", "scripts/\n");
    await tree.put(".oxlintrc.json", "{}");
    await tree.put("scripts/oxlint.config.ts", "export default {};");
    expect((await scopeGate()).exitCode).toBe(0);
    expect((await scopeGate("--check")).exitCode).toBe(0);
    await tree.put(SCOPED, PLANT);
    const diagnosed = await diagnostics();
    for (const rule of SCOPE_SERVICE) expect(diagnosed.get(SCOPED) ?? []).not.toContain(rule);
    expect(diagnosed.get(SCOPED)).toEqual(expect.arrayContaining(KIT_SERVICE));
  }
}, 180_000);
