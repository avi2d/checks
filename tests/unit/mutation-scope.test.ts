import { expect, test } from "bun:test";
import { Effect } from "effect";
import type { Change } from "../../src/core/git.ts";
import { coveringTests, envLines, mutatedBy, parseArgs, pickFromDiff, readersOf, STRYKER_DEFAULT_MUTATE } from "../../src/testing/mutation-scope.ts";

const TUI_DASH_MUTATE = ["packages/*/src/**/*.ts", "!packages/*/src/live/**", "!packages/*/src/bin.ts"];

test("Stryker's default globs mutate the code under src and lib, and no test, spec or __tests__ file", () => {
  const mutated = mutatedBy(STRYKER_DEFAULT_MUTATE);

  expect(["src/a.ts", "lib/b/c.mjs", "src/view.tsx"].filter(mutated)).toEqual(["src/a.ts", "lib/b/c.mjs", "src/view.tsx"]);
  expect(["src/a.test.ts", "src/a.spec.ts", "src/__tests__/a.ts", "tests/unit/a.test.ts", "scripts/a.ts", "src/notes.md"].filter(mutated)).toEqual([]);
});

test("a negated glob drops what an earlier glob matched, and a leading ./ matches as the bare path", () => {
  const mutated = mutatedBy(["./packages/*/src/**/*.ts", "!packages/*/src/live/**", "!packages/*/src/bin.ts"]);

  expect(["packages/ui/src/layout.ts", "packages/quota/src/live/layer.ts", "packages/quota/src/bin.ts", "packages/quota/bin.ts"].filter(mutated)).toEqual([
    "packages/ui/src/layout.ts",
  ]);
});

test("a later glob brings back what an earlier negated glob dropped", () => {
  expect(mutatedBy(["src/**/*.ts", "!src/live/**", "src/live/kept.ts"])("src/live/kept.ts")).toBe(true);
});

const written = (path: string): Change => ({ kind: "written", path });

test("the diff scopes changed sources, marks the ones the base lacks as added, and keeps tests and test tree apart", () => {
  const picked = pickFromDiff(
    [
      written("packages/ui/src/layout.ts"),
      written("packages/ui/src/sources.ts"),
      written("packages/quota/src/live/layer.ts"),
      written("tests/unit/ui/layout.test.ts"),
      written("tests/e2e/ui.test.ts"),
      written("tests/lib/session-fixture.ts"),
      { kind: "deleted", path: "packages/ui/src/gone.ts" },
      { kind: "deleted", path: "tests/unit/ui/gone.test.ts" },
    ],
    mutatedBy(TUI_DASH_MUTATE),
    new Set(["packages/ui/src/layout.ts", "packages/quota/src/live/layer.ts"]),
  );

  expect([...picked.scope]).toEqual(["packages/ui/src/layout.ts", "packages/ui/src/sources.ts"]);
  expect([...picked.added]).toEqual(["packages/ui/src/sources.ts"]);
  expect([...picked.tests]).toEqual(["tests/unit/ui/layout.test.ts", "tests/unit/ui/gone.test.ts"]);
  expect([...picked.touched]).toEqual(["tests/unit/ui/layout.test.ts", "tests/e2e/ui.test.ts", "tests/lib/session-fixture.ts", "tests/unit/ui/gone.test.ts"]);
});

test("a rename between sources scopes both names, one into the sources scopes the new name as added, and one out of them scopes nothing", () => {
  const picked = pickFromDiff(
    [
      { kind: "renamed", from: "src/old.ts", path: "src/new.ts", edited: false },
      { kind: "renamed", from: "lib/outside.ts", path: "src/inside.ts", edited: true },
      { kind: "renamed", from: "src/leaving.ts", path: "lib/left.ts", edited: false },
      { kind: "renamed", from: "tests/unit/a.test.ts", path: "tests/unit/b.test.ts", edited: false },
    ],
    mutatedBy(["src/**/*.ts"]),
    new Set(["src/old.ts", "lib/outside.ts", "src/leaving.ts"]),
  );

  expect([...picked.scope]).toEqual(["src/old.ts", "src/new.ts", "src/inside.ts"]);
  expect([...picked.added]).toEqual(["src/inside.ts"]);
  expect(picked.renamed).toEqual(["src/old.ts:src/new.ts"]);
  expect([...picked.tests]).toEqual(["tests/unit/a.test.ts", "tests/unit/b.test.ts"]);
});

test("a reader reaches a changed helper through each import form, and through a preload when it is a test file", () => {
  const sources = new Map([
    ["tests/lib/tree.ts", 'import { effect0 } from "./effect";\n'],
    ["tests/lib/preload.ts", 'const { setup0 } = await import("./setup/index.ts");\n'],
    ["tests/unit/a.test.ts", 'import { tree0 } from "../lib/tree.ts";\n'],
    ["tests/unit/b.test.ts", "export {};\n"],
    ["tests/lib/helper.ts", "export {};\n"],
    ["tests/lib/effect.ts", "export {};\n"],
  ]);

  expect(readersOf(sources, ["tests/lib/effect.ts"], ["./tests/lib/preload.ts"])).toEqual(
    new Map([
      ["tests/lib/tree.ts", "tests/lib/effect.ts"],
      ["tests/unit/a.test.ts", "tests/lib/effect.ts"],
    ]),
  );
  expect(readersOf(sources, ["tests/lib/setup/index.ts"], ["./tests/lib/preload.ts"])).toEqual(
    new Map([
      ["tests/lib/preload.ts", "tests/lib/setup/index.ts"],
      ["tests/unit/a.test.ts", "tests/lib/setup/index.ts"],
      ["tests/unit/b.test.ts", "tests/lib/setup/index.ts"],
    ]),
  );
});

test("a reader reaches a changed fixture by its path, its directory in segments or with a trailing slash, and not a sibling directory sharing its prefix", () => {
  const sources = new Map([
    ["tests/unit/file.test.ts", 'const run = "fixtures/eval/run.json";\n'],
    ["tests/unit/joined.test.ts", 'const run = join(dir, "..", "fixtures", "eval");\n'],
    ["tests/unit/slashed.test.ts", 'const runs = new URL("../fixtures/eval/", import.meta.url);\n'],
    ["tests/unit/templated.test.ts", "const run = `../fixtures/eval/${name}.json`;\n"],
    ["tests/unit/sibling.test.ts", 'const runs = new URL("../fixtures/evaluated/", import.meta.url);\n'],
  ]);

  expect([...readersOf(sources, ["tests/fixtures/eval/run.json"], []).keys()].sort()).toEqual([
    "tests/unit/file.test.ts",
    "tests/unit/joined.test.ts",
    "tests/unit/slashed.test.ts",
    "tests/unit/templated.test.ts",
  ]);
});

test("a changed file never reads as a reader of another changed file", () => {
  const sources = new Map([["tests/unit/a.test.ts", 'import { effect0 } from "../lib/effect";\n']]);

  expect(readersOf(sources, ["tests/lib/effect.ts", "tests/unit/a.test.ts"], [])).toEqual(new Map());
});

const baseline = {
  files: {
    "src/covered.ts": { mutants: [{ coveredBy: ["1"], killedBy: ["0"] }, { killedBy: ["2"] }] },
    "src/static.ts": { mutants: [{ coveredBy: [], killedBy: ["2", "0"] }] },
    "src/live/layer.ts": { mutants: [{ coveredBy: ["0"] }] },
    "src/elsewhere.ts": { mutants: [{ coveredBy: ["9"] }] },
  },
  testFiles: {
    "tests/unit/a.test.ts": { tests: [{ id: "0" }] },
    "tests/unit/b.test.ts": { tests: [{ id: "1" }, { id: "2" }] },
  },
};

test("a source enters through each changed test that covers or kills one of its mutants, in the mutate scope only", () => {
  const covering = coveringTests(baseline, new Set(["tests/unit/a.test.ts", "tests/unit/b.test.ts"]), mutatedBy(["src/**/*.ts", "!src/live/**"]));

  expect(covering).toEqual(
    new Map([
      ["src/covered.ts", ["tests/unit/a.test.ts", "tests/unit/b.test.ts"]],
      ["src/static.ts", ["tests/unit/a.test.ts", "tests/unit/b.test.ts"]],
    ]),
  );
});

test("a source no changed test covers or kills stays out", () => {
  expect(coveringTests(baseline, new Set(["tests/unit/c.test.ts"]), mutatedBy(["src/**/*.ts"]))).toEqual(new Map());
});

test("the lines name each list sorted and comma separated, an empty one included", () => {
  expect(envLines({ scope: ["src/b.ts", "src/a.ts"], added: [], renamed: ["src/old.ts:src/new.ts"], tests: ["tests/unit/a.test.ts"], staleTests: [] })).toBe(
    ["SCOPE=src/a.ts,src/b.ts", "ADDED=", "RENAMED=src/old.ts:src/new.ts", "TESTS=tests/unit/a.test.ts", "STALE_TESTS="].join("\n"),
  );
});

test("the arguments are a base and an optional report, and nothing else", async () => {
  const parsed = (argv: readonly string[]) => Effect.runPromise(parseArgs(argv).pipe(Effect.match({ onFailure: () => "usage", onSuccess: (options) => options })));

  expect(await parsed(["abc123"])).toEqual({ base: "abc123", baseline: undefined });
  expect(await parsed(["abc123", "full/mutation.json"])).toEqual({ base: "abc123", baseline: "full/mutation.json" });
  expect(await Promise.all([[], ["--full"], ["abc123", "--json"], ["abc123", "a.json", "extra"]].map(parsed))).toEqual(["usage", "usage", "usage", "usage"]);
});
