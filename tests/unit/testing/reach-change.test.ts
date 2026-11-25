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

function assertMappedSelection(select: () => readonly string[]): void {
  expect(select()).toEqual([A, B]);
}

function showRejected(assertion: () => void): void {
  let failure = "";
  try {
    assertion();
  } catch (cause) {
    failure = String(cause);
  }
  console.log(failure);
  expect(failure).not.toBe("");
}

test("the map selection check rejects an implementation that always runs everything", () => {
  showRejected(() => assertMappedSelection(() => TESTS));
  const change = compareReach({ reach: { "src/page.css": [A] } }, { reach: { "src/page.css": [A, B] } });
  assertMappedSelection(() => addReachTests(TESTS, new Set(), change));
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

function assertHelperSelection(reached: ReadonlySet<string>): void {
  expect(TESTS.filter((file) => reached.has(file))).toEqual([A, B]);
}

test("the helper selection check rejects an implementation that selects only direct importers", async () => {
  showRejected(() => assertHelperSelection(new Set([A])));
  const reached = await run(sources);
  expect(reached).toBeDefined();
  assertHelperSelection(reached ?? new Set());
});

test("an unresolvable import cannot narrow the helper's tests", async () => {
  const broken = new Map(sources);
  broken.set(C, 'import "./missing.ts";');
  expect(await run(broken)).toBeUndefined();
});

test("an unchanged Astro importer makes the helper graph fall back rather than omit its test", async () => {
  const unsupported = new Map(sources);
  unsupported.set("src/page.astro", '---\nimport "../tests/e2e/lib/helper.ts";\n---');
  unsupported.set(C, 'import "../../src/page.astro";');
  const ignoringAstro = new Map(unsupported);
  ignoringAstro.set("src/page.astro", "");
  const wrong = await run(ignoringAstro);
  showRejected(() => expect(wrong).toBeUndefined());
  expect(await run(unsupported)).toBeUndefined();
});

test("a dynamic import in an unparsed source cannot narrow a helper change", async () => {
  const dynamic = new Map(sources);
  dynamic.set("src/page.astro", "---\nconst component = import(path);\n---");
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
    ["src/page.astro", "<p>unrelated</p>"],
  ]);
  const reached = await Effect.runPromise(helperImpact(process.cwd(), [capture], tree, [...tree.keys()]).pipe(Effect.provide(platform)));
  expect(reached).toBeDefined();
  const selected = addReachTests([first, second, changed, unrelated], new Set([...(reached ?? []), changed]), { kind: "mapped", patterns: [] });
  expect(selected).toEqual([first, second, changed]);
});

test("a changed Astro source runs everything rather than relying on an incomplete graph", () => {
  const tree: Repository = { files: [], sources: new Map(), bins: new Map(), self: undefined, preloads: [], reach: [] };
  expect(narrowTests(["src/page.astro"], tree, TESTS).kind).toBe("full");
});

test("a dynamic import of a helper cannot narrow the helper's tests", async () => {
  const dynamic = new Map(sources);
  dynamic.set(C, 'import("./lib/helper.ts");');
  expect(await run(dynamic)).toBeUndefined();
});
