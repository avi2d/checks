import { $ } from "bun";
import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Effect } from "effect";
import { platform } from "../../../src/core/bun-platform.ts";
import { pathsSinceMergeBase } from "../../../src/core/git.ts";
import { readChangedNarrowing } from "../../../src/testing/affected-tests.ts";
import { withoutPullRequestEvent } from "../../lib/env.ts";
import { runCi } from "../lib/ci-command.ts";
import { CHECKOUT, fixtureRepos, ran, UNVENDORED_BUNFIG } from "../lib/fixture-repo.ts";

const open = fixtureRepos("checks-reach-change-");
const A = "tests/e2e/a.test.ts";
const B = "tests/e2e/b.test.ts";
const C = "tests/e2e/c.test.ts";
const TESTS = [A, B, C];
const HELPER = "tests/e2e/lib/site.ts";

test("type-only and Vite asset imports do not make a map entry, new helper and new test run unrelated tests or build the site", async () => {
  const repo = await open({
    ".gitignore": "node_modules/\n",
    "checks.config.ts": `export default { reach: { "src/components/Hero.astro": ["${A}"] } };`,
    "src/content.config.ts": 'import { defineCollection } from "astro:content";',
    "src/lib/articles.ts": 'import { getCollection } from "astro:content"; import type { Element } from "hast"; export type { Element } from "hast";',
    "node_modules/@types/hast/package.json": '{"name":"@types/hast","types":"index.d.ts"}',
    "node_modules/@types/hast/index.d.ts": "export interface Element { tagName: string; }",
    "src/pages/og-image.png.ts": 'import css from "../styles/tokens.css?raw"; import font from "../fonts/playfair.woff2?inline";',
    "src/styles/tokens.css": ":root { color: black; }",
    "src/fonts/playfair.woff2": "font fixture",
    "src/pages/index.astro": '---\nconst panel = import("../components/VariantPanel.astro");\n---\n<main>site</main>',
    "src/components/VariantPanel.astro": "<aside />",
    "src/components/Hero.astro": "<section />",
    [A]: "export {};",
    [C]: "export {};",
  });
  const base = await repo.commit("test: base");
  await repo.write({
    "checks.config.ts": `export default { reach: { "src/components/Hero.astro": ["${A}", "${B}"] } };`,
    [HELPER]: "export const site = 1;",
    [B]: 'import { site } from "./lib/site.ts";',
  });
  await repo.commit("test: add mapped test and helper");
  const selection = await Effect.runPromise(Effect.gen(function* () {
    const changed = yield* pathsSinceMergeBase(base, "HEAD", repo.dir);
    return yield* readChangedNarrowing(repo.dir, changed, TESTS, "e2e", base);
  }).pipe(Effect.provide(platform)));
  expect(selection).toEqual({ kind: "files", files: [A, B] });
  const output = join(repo.dir, "output");
  const result = await runCi("changes", [], {
    PATH: process.env["PATH"] ?? "",
    BASE_SHA: base,
    PLAN_BROWSER: "true",
    GITHUB_OUTPUT: output,
  }, repo.dir);
  expect(result.exitCode).toBe(0);
  expect(Object.fromEntries((await readFile(output, "utf8")).trim().split("\n").map((line) => line.split("=")))).toEqual({
    "docs-only": "false",
    "tests-only": "true",
    browser: "false",
  });
});

test.each(["@helpers/*", "internal/*", "site-helper"])("an unresolved %s alias does not silently omit helper tests", async (alias) => {
  const specifier = alias.replace("*", "missing");
  const repo = await open({
    "tsconfig.json": '{"extends":"./config/paths.json"}',
    "config/paths.json": JSON.stringify({ compilerOptions: { paths: { [alias]: ["./tests/e2e/lib/*"] } } }),
    [HELPER]: "export const site = 1;",
    [A]: 'import { site } from "./lib/site.ts";',
    [B]: `import "${specifier}?raw";`,
    [C]: "export {};",
  });
  const result = await Effect.runPromise(readChangedNarrowing(repo.dir, [HELPER], TESTS, "e2e").pipe(Effect.provide(platform)));
  expect(result).toEqual({ kind: "full", because: "the changed test helper's import graph cannot be resolved" });
});

test("a resolved alias with a Vite suffix does not omit a helper importer or run an unrelated test", async () => {
  const repo = await open({
    "tsconfig.json": '{"compilerOptions":{"paths":{"@helpers/*":["./tests/e2e/lib/*"]}}}',
    [HELPER]: "export const site = 1;",
    [A]: 'import { site } from "@helpers/site.ts?raw";',
    [B]: 'import { site } from "./lib/site.ts";',
    [C]: "export {};",
  });
  const result = await Effect.runPromise(readChangedNarrowing(repo.dir, [HELPER], TESTS, "e2e").pipe(Effect.provide(platform)));
  expect(result).toEqual({ kind: "files", files: [A, B] });
});

test("a helper read by path through another helper does not omit the transitive test", async () => {
  const repo = await open({
    [HELPER]: "export const site = 1;",
    "tests/e2e/lib/wrapper.ts": `export const path = "${HELPER}";`,
    [A]: 'import { path } from "./lib/wrapper.ts";',
    [B]: `const path = "${HELPER}";`,
    [C]: "export {};",
  });
  const result = await Effect.runPromise(readChangedNarrowing(repo.dir, [HELPER], TESTS, "e2e").pipe(Effect.provide(platform)));
  expect(result).toEqual({ kind: "files", files: [A, B] });
});

test("a module helper does not lose its explicit reach-map tests", async () => {
  const repo = await open({
    "checks.config.ts": `export default { reach: { "${HELPER}": ["${A}"] } };`,
    [HELPER]: "export const site = 1;",
    [A]: "export {};",
    [B]: "export {};",
    [C]: 'import { site } from "./lib/site.ts";',
  });
  const result = await Effect.runPromise(readChangedNarrowing(repo.dir, [HELPER], TESTS, "e2e").pipe(Effect.provide(platform)));
  expect(result).toEqual({ kind: "files", files: [A, C] });
});

test.each([HELPER, "tests/e2e/lib/preload.ts"])("a preloaded %s change cannot narrow the tier", async (file) => {
  const repo = await open({
    "bunfig.toml": '[test]\npreload = ["./tests/e2e/lib/preload.ts"]',
    "tests/e2e/lib/preload.ts": 'import "./site.ts";',
    [HELPER]: "export const site = 1;",
    [A]: "export {};",
    [C]: "export {};",
  });
  const result = await Effect.runPromise(readChangedNarrowing(repo.dir, [file], [A, C], "e2e").pipe(Effect.provide(platform)));
  expect(result.kind).toBe("full");
});

test.each(["tests/e2e/tsconfig.json", "tests/e2e/browser.config.ts", "tests/e2e/lib/serve.sh", "tests/e2e/data.json"])(
  "a shared %s change does not silently run no tests",
  async (file) => {
    const repo = await open({ [file]: "{}", [A]: "export {};", [C]: "export {};" });
    const result = await Effect.runPromise(readChangedNarrowing(repo.dir, [file], [A, C], "e2e").pipe(Effect.provide(platform)));
    expect(result.kind).toBe("full");
  },
);

test("fixture data still selects its path reader rather than the whole tier", async () => {
  const file = "tests/fixtures/data.json";
  const repo = await open({ [file]: "{}", [A]: `const path = "${file}";`, [C]: "export {};" });
  const result = await Effect.runPromise(readChangedNarrowing(repo.dir, [file], [A, C], "e2e").pipe(Effect.provide(platform)));
  expect(result).toEqual({ kind: "files", files: [A] });
});

test("an unloadable base config cannot narrow a valid head config", async () => {
  const repo = await open({ "checks.config.ts": 'throw new Error("broken base");', [A]: "export {};", [C]: "export {};" });
  const base = await repo.commit("test: base with unloadable config");
  await repo.write({ "checks.config.ts": `export default { reach: { "src/page.astro": ["${A}"] } };` });
  await repo.commit("test: valid head config");
  const result = await Effect.runPromise(readChangedNarrowing(repo.dir, ["checks.config.ts"], [A, C], "e2e", base).pipe(Effect.provide(platform)));
  expect(result.kind).toBe("full");
});

test.each(Object.entries({
  default: [],
  unit: ["--tier=unit"],
  e2e: ["--tier=e2e"],
  pr: ["--pr"],
  "pr-unit": ["--pr", "--tier=unit"],
  "pr-e2e": ["--pr", "--tier=e2e"],
  "pr-screens": ["--pr-screens"],
  changed: ["--changed"],
}))("an unloadable head config stops %s rather than running tests", async (_name, args) => {
  const passing = 'import { expect, test } from "bun:test"; test("passes", () => expect(1).toBe(1));';
  const repo = await open({
    "package.json": JSON.stringify({ type: "module" }),
    "bunfig.toml": UNVENDORED_BUNFIG,
    "checks.config.ts": 'throw new Error("broken head");',
    "tests/unit/a.test.ts": passing,
    [A]: passing,
    "tests/pixel/a.test.ts": passing,
  });
  const result = await ran($`bun ${join(CHECKOUT, "src/testing/test.ts")} ${args}`.cwd(repo.dir).env({ ...withoutPullRequestEvent(), CI: "true" }));
  expect(result.exitCode).toBe(2);
  expect(result.text).toContain("checks.config.ts does not load");
  expect(result.text).not.toContain("1 pass");
}, 60_000);
