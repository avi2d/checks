import { expect, test } from "bun:test";
import { Effect } from "effect";
import { platform } from "../../../src/core/bun-platform.ts";
import { addReachTests, compareLoadedSettings, compareReach } from "../../../src/core/reach-change.ts";
import { testsOnlyWithReach } from "../../../src/delivery/ci/changes.ts";
import { helperImpact } from "../../../src/testing/helper-impact.ts";
import { narrowTests, type Repository } from "../../../src/testing/affected-tests.ts";

const A = "tests/e2e/a.test.ts";
const B = "tests/e2e/b.test.ts";
const C = "tests/e2e/c.test.ts";
const TESTS = [A, B, C];

test("a map entry change selects its old and new tests and the changed test, not the whole suite", () => {
  const before = { reach: { "src/page.css": [A] }, smoke: [A] };
  const after = { reach: { "src/page.css": [A, B] }, smoke: [A] };
  const change = compareReach(before, after);
  const selected = addReachTests(TESTS, new Set([B]), change);
  expect(selected).toEqual([A, B]);
  expect(testsOnlyWithReach(["checks.config.ts", B, "tests/e2e/lib/helper.ts"], change.kind === "mapped")).toBe(true);
});

test("a non-map change runs every test rather than using the reach map", () => {
  const change = compareReach({ reach: { "src/a": [A] }, smoke: [A] }, { reach: { "src/a": [B] }, smoke: [B] });
  expect(change.kind).toBe("full");
  expect(addReachTests(TESTS, new Set(), change)).toEqual(TESTS);
  expect(testsOnlyWithReach(["checks.config.ts", B], false)).toBe(false);
});

test("a malformed map cannot narrow the run", () => {
  expect(compareReach({ reach: "bad" }, { reach: {} }).kind).toBe("full");
});

test("an unloadable config cannot narrow the run", async () => {
  const bad = Effect.fail("cannot load");
  const good = Effect.succeed({ reach: { "src/a": [A] } });
  expect(await Effect.runPromise(compareLoadedSettings(bad, good))).toEqual({ kind: "full" });
  expect(await Effect.runPromise(compareLoadedSettings(good, bad))).toEqual({ kind: "full" });
});

const HELPER = "tests/e2e/lib/helper.ts";
const WRAPPER = "tests/e2e/lib/wrapper.ts";
const sources = new Map([
  [HELPER, "export const helper = 1;"],
  [WRAPPER, 'export { helper } from "./helper.ts";'],
  [A, 'import { helper } from "./lib/helper.ts";'],
  [B, 'import { helper } from "./lib/wrapper.ts";'],
  [C, "export {};"],
]);

const run = (input: ReadonlyMap<string, string>) => Effect.runPromise(helperImpact(process.cwd(), [HELPER], input, [...input.keys()]).pipe(Effect.provide(platform)));

test("a helper selects both its direct and indirect importers, not the unrelated test", async () => {
  const selected = await run(sources);
  expect(selected).toBeDefined();
  const reached = TESTS.filter((file) => selected?.has(file));
  expect(reached).toEqual([A, B]);
});

test("a root-level importer does not resolve relative to its filename", async () => {
  const tree = new Map(sources);
  tree.set("runner.ts", 'import "./tests/e2e/lib/helper.ts";');
  tree.set(C, 'import "../../runner.ts";');
  const reached = await run(tree);
  expect(reached).toBeDefined();
  expect(TESTS.filter((file) => reached?.has(file))).toEqual(TESTS);
});

test.each(['import "./missing.ts";', 'export * from "./missing.ts?raw";', 'import("./missing.ts#fragment");', 'require("./missing.ts?inline");'])("an unresolved relative %s cannot narrow the helper's tests", async (source) => {
  const broken = new Map(sources);
  broken.set(C, source);
  expect(await run(broken)).toBeUndefined();
});

test.each([
  ["astro", '---\nimport "../tests/e2e/lib/helper.ts";\n---'],
  ["svelte", '<script>import "../tests/e2e/lib/helper.ts";</script>'],
  ["vue", '<script>import "../tests/e2e/lib/helper.ts";</script>'],
])("a literal import through %s does not omit the helper's transitive test", async (extension, source) => {
  const tree = new Map(sources);
  tree.set(`src/page.${extension}`, source);
  tree.set(C, `import "../../src/page.${extension}";`);
  const reached = await run(tree);
  expect(reached).toBeDefined();
  expect(TESTS.filter((file) => reached?.has(file))).toEqual(TESTS);
});

test.each(["import(path)", 'import("./" + path)', "require(path)"])("a non-literal %s in an unparsed source cannot silently omit a helper's importer", async (expression) => {
  const dynamic = new Map(sources);
  dynamic.set("src/page.astro", `---\nconst component = ${expression};\n---`);
  expect(await run(dynamic)).toBeUndefined();
});

test("an unrelated Astro file does not turn a transitive helper chain into a full run", async () => {
  const capture = "tests/e2e/lib/capture.ts";
  const paint = "tests/e2e/lib/contacts-paint.ts";
  const first = "tests/e2e/contacts-paint.test.ts";
  const second = "tests/e2e/contacts-paint-webkit.test.ts";
  const changed = "tests/e2e/new.test.ts";
  const unrelated = "tests/e2e/other.test.ts";
  const tree = new Map([
    [capture, "export const captured = 1;"],
    [paint, 'export { captured } from "./capture.ts";'],
    [first, 'import { captured } from "./lib/contacts-paint.ts";'],
    [second, 'import { captured } from "./lib/contacts-paint.ts";'],
    [changed, "export {};"],
    [unrelated, "export {};"],
    ["src/content.config.ts", 'import { defineCollection } from "astro:content";'],
    ["src/page.astro", '---\nimport { getCollection } from "astro:content";\nconst panel = import("./VariantPanel.astro");\n---\n<p>capture</p>'],
    ["src/VariantPanel.astro", "<aside>unrelated</aside>"],
  ]);
  const reached = await Effect.runPromise(helperImpact(process.cwd(), [capture], tree, [...tree.keys()]).pipe(Effect.provide(platform)));
  expect(reached).toBeDefined();
  const selected = addReachTests([first, second, changed, unrelated], new Set([...(reached ?? []), changed]), { kind: "mapped", patterns: [] });
  expect(selected).toEqual([first, second, changed]);
});

test.each(["astro", "svelte", "vue", "sh"])("a mapped %s source does not run the whole suite", (extension) => {
  const file = `src/page.${extension}`;
  const tree: Repository = {
    files: [file, ...TESTS],
    sources: new Map(),
    bins: new Map(),
    self: undefined,
    preloads: [],
    reach: [{ changed: file, tests: [A] }],
  };
  expect(narrowTests([file], tree, TESTS)).toEqual({ kind: "files", files: [A] });
});

test("a literal dynamic import does not omit the helper's importer or force a full run", async () => {
  const dynamic = new Map(sources);
  dynamic.set(C, 'import("./lib/helper.ts");');
  const reached = await run(dynamic);
  expect(reached).toBeDefined();
  expect(TESTS.filter((file) => reached?.has(file))).toEqual(TESTS);
});

test.each([
  'import type { Element } from "hast";',
  'export type { Element } from "hast";',
  'export type * from "hast";',
  'import { type Element } from "hast";',
  'export { type Element } from "hast";',
  'import type { Element } from "./missing.ts";',
  'export type { Element } from "./missing.ts";',
  'export type * from "./missing.ts";',
  'import { type Element } from "./missing.ts";',
  'export { type Element } from "./missing.ts";',
  'import "uninstalled-package";',
  'export * from "uninstalled-package";',
  'import("uninstalled-package");',
  'require("uninstalled-package");',
])("an erased type or external %s does not force unrelated helper tests to run", async (source) => {
  const tree = new Map(sources);
  tree.set("src/unrelated.ts", source);
  const reached = await run(tree);
  expect(reached).toBeDefined();
  expect(TESTS.filter((file) => reached?.has(file))).toEqual([A, B]);
});

test.each([
  'import "./lib/helper.ts?raw";',
  'export { helper } from "./lib/helper.ts?inline";',
  'export * from "./lib/helper.ts#fragment";',
  'import("./lib/helper.ts?raw#fragment");',
  'import("./lib/helper.ts?raw/../other");',
  'require("./lib/helper.ts?inline");',
])("a suffixed %s does not omit the helper's importer", async (source) => {
  const tree = new Map(sources);
  tree.set(C, source);
  const reached = await run(tree);
  expect(reached).toBeDefined();
  expect(TESTS.filter((file) => reached?.has(file))).toEqual(TESTS);
});

test.each(["astro", "svelte", "vue"])("a query-suffixed import in %s does not omit the helper's transitive test", async (extension) => {
  const tree = new Map(sources);
  tree.set(`src/page.${extension}`, '<script>import "../tests/e2e/lib/helper.ts?raw/../other#fragment";</script>');
  tree.set(C, `import "../../src/page.${extension}";`);
  const reached = await run(tree);
  expect(reached).toBeDefined();
  expect(TESTS.filter((file) => reached?.has(file))).toEqual(TESTS);
});

test.each([
  'import { type Element, helper } from "./missing.ts";',
  'export { type Element, helper } from "./missing.ts";',
])("a mixed type and runtime %s cannot hide an unresolved local dependency", async (source) => {
  const tree = new Map(sources);
  tree.set(C, source);
  expect(await run(tree)).toBeUndefined();
});

test("a non-literal module import cannot silently omit a helper's importer", async () => {
  const dynamic = new Map(sources);
  dynamic.set(C, "import(path);");
  expect(await run(dynamic)).toBeUndefined();
});
