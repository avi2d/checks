import { expect, test } from "bun:test";
import { Effect } from "effect";
import type { Change } from "../../src/core/git.ts";
import { coveringTests, envLines, mutatedBy, parseArgs, pickFromDiff, preloadChange, readersOf, STRYKER_DEFAULT_MUTATE } from "../../src/testing/mutation-scope.ts";

const ROOT = "/runner/work/repo";
const TUI_DASH_MUTATE = ["packages/*/src/**/*.ts", "!packages/*/src/live/**", "!packages/*/src/bin.ts"];

test("Stryker's default globs mutate the code under src and lib, and no test, spec or __tests__ file", () => {
  const mutated = mutatedBy(STRYKER_DEFAULT_MUTATE, ROOT);

  expect(["src/a.ts", "lib/b/c.mjs", "src/view.tsx"].filter(mutated)).toEqual(["src/a.ts", "lib/b/c.mjs", "src/view.tsx"]);
  expect(["src/a.test.ts", "src/a.spec.ts", "src/__tests__/a.ts", "tests/unit/a.test.ts", "scripts/a.ts", "src/notes.md"].filter(mutated)).toEqual([]);
});

test("a negated glob drops what an earlier glob matched, and a leading ./ matches as the bare path", () => {
  const mutated = mutatedBy(["./packages/*/src/**/*.ts", "!packages/*/src/live/**", "!packages/*/src/bin.ts"], ROOT);

  expect(["packages/ui/src/layout.ts", "packages/quota/src/live/layer.ts", "packages/quota/src/bin.ts", "packages/quota/bin.ts"].filter(mutated)).toEqual([
    "packages/ui/src/layout.ts",
  ]);
});

test("a glob resolves against the working directory as Stryker's FileMatcher resolves it, absolute or relative", () => {
  const mutated = mutatedBy([`${ROOT}/src/**/*.ts`, "!../repo/src/live/**"], ROOT);

  expect(["src/a.ts", "src/live/layer.ts", "lib/a.ts", "src/.hidden/a.ts"].filter(mutated)).toEqual(["src/a.ts"]);
  expect(mutatedBy(["/elsewhere/src/**/*.ts"], ROOT)("src/a.ts")).toBe(false);
});

test("a later glob brings back what an earlier negated glob dropped", () => {
  expect(mutatedBy(["src/**/*.ts", "!src/live/**", "src/live/kept.ts"], ROOT)("src/live/kept.ts")).toBe(true);
});

const written = (path: string): Change => ({ kind: "written", path });

test("the diff scopes changed sources, and keeps tests and test tree apart", () => {
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
    mutatedBy(TUI_DASH_MUTATE, ROOT),
  );

  expect([...picked.scope]).toEqual(["packages/ui/src/layout.ts", "packages/ui/src/sources.ts"]);
  expect([...picked.tests]).toEqual(["tests/unit/ui/layout.test.ts", "tests/unit/ui/gone.test.ts"]);
  expect([...picked.touched]).toEqual(["tests/unit/ui/layout.test.ts", "tests/e2e/ui.test.ts", "tests/lib/session-fixture.ts", "tests/unit/ui/gone.test.ts"]);
});

test("a rename between sources scopes both names, one into the sources scopes the new name, and one out of them scopes nothing", () => {
  const picked = pickFromDiff(
    [
      { kind: "renamed", from: "src/old.ts", path: "src/new.ts", edited: false },
      { kind: "renamed", from: "lib/outside.ts", path: "src/inside.ts", edited: true },
      { kind: "renamed", from: "src/leaving.ts", path: "lib/left.ts", edited: false },
      { kind: "renamed", from: "tests/unit/a.test.ts", path: "tests/unit/b.test.ts", edited: false },
    ],
    mutatedBy(["src/**/*.ts"], ROOT),
  );

  expect([...picked.scope]).toEqual(["src/old.ts", "src/new.ts", "src/inside.ts"]);
  expect([...picked.tests]).toEqual(["tests/unit/a.test.ts", "tests/unit/b.test.ts"]);
});

test("a reader reaches a changed helper through each import form, and an index file through its directory", () => {
  const sources = new Map([
    ["tests/lib/tree.ts", 'import { effect0 } from "./effect";\n'],
    ["tests/lib/preload.ts", 'const { setup0 } = await import("./setup/index.ts");\n'],
    ["tests/unit/a.test.ts", 'import { tree0 } from "../lib/tree.ts";\n'],
    ["tests/unit/b.test.ts", "export {};\n"],
    ["tests/lib/helper.ts", "export {};\n"],
    ["tests/lib/effect.ts", "export {};\n"],
  ]);

  expect(readersOf(sources, ["tests/lib/effect.ts"])).toEqual(
    new Map([
      ["tests/lib/tree.ts", "tests/lib/effect.ts"],
      ["tests/unit/a.test.ts", "tests/lib/effect.ts"],
    ]),
  );
  expect(readersOf(sources, ["tests/lib/setup/index.ts"])).toEqual(new Map([["tests/lib/preload.ts", "tests/lib/setup/index.ts"]]));
});

test("every unit test reads a change to the preload list, to a preload, or to a file a preload loads, and to nothing else", () => {
  const preloads = { atBase: ["test-setup.ts", "tests/lib/assertions.ts"], atHead: ["test-setup.ts", "tests/lib/assertions.ts"] };
  const loaded = new Set(["test-setup.ts", "src/clock.ts"]);
  const changeTo = (paths: readonly string[], lists = preloads) => preloadChange(new Set(paths), lists, loaded);

  expect(changeTo(["test-setup.ts"])).toBe("test-setup.ts");
  expect(changeTo(["tests/lib/assertions.ts"])).toBe("tests/lib/assertions.ts");
  expect(changeTo(["src/clock.ts"])).toBe("src/clock.ts");
  expect(changeTo([], { atBase: preloads.atBase, atHead: ["test-setup.ts"] })).toBe("the [test] preload list in bunfig.toml");
  expect(changeTo(["src/other.ts", "tests/lib/helper.ts"])).toBeUndefined();
});

test("a reader reaches a changed fixture by its path, its directory in segments or with a trailing slash, and not a sibling directory sharing its prefix", () => {
  const sources = new Map([
    ["tests/unit/file.test.ts", 'const run = "fixtures/eval/run.json";\n'],
    ["tests/unit/joined.test.ts", 'const run = join(dir, "..", "fixtures", "eval");\n'],
    ["tests/unit/slashed.test.ts", 'const runs = new URL("../fixtures/eval/", import.meta.url);\n'],
    ["tests/unit/templated.test.ts", "const run = `../fixtures/eval/${name}.json`;\n"],
    ["tests/unit/sibling.test.ts", 'const runs = new URL("../fixtures/evaluated/", import.meta.url);\n'],
  ]);

  expect([...readersOf(sources, ["tests/fixtures/eval/run.json"]).keys()].sort()).toEqual([
    "tests/unit/file.test.ts",
    "tests/unit/joined.test.ts",
    "tests/unit/slashed.test.ts",
    "tests/unit/templated.test.ts",
  ]);
});

test("an import naming a file reaches that file and not the index of a directory sharing its name, and a bare one reaches the file first", () => {
  const sources = new Map([
    ["tests/unit/named.test.ts", 'import { a } from "../lib/assertions.ts";\n'],
    ["tests/unit/bare.test.ts", 'import { a } from "../lib/assertions";\n'],
    ["tests/unit/indexed.test.ts", 'import { a } from "../lib/assertions/index.ts";\n'],
    ["tests/lib/assertions.ts", "export {};\n"],
    ["tests/lib/assertions/index.ts", "export {};\n"],
  ]);

  expect([...readersOf(sources, ["tests/lib/assertions.ts"]).keys()].sort()).toEqual(["tests/unit/bare.test.ts", "tests/unit/named.test.ts"]);
  expect([...readersOf(sources, ["tests/lib/assertions/index.ts"]).keys()]).toEqual(["tests/unit/indexed.test.ts"]);
});

test("a require through a directory entry reaches the package main, and prefers .js over .ts", () => {
  const sources = new Map([
    ["stryker.conf.cjs", 'const { ABS } = require("./settings");\nconst { dual } = require("./dual");\n'],
    ["settings/mode.cjs", "module.exports = {};\n"],
    ["dual.js", "module.exports = {};\n"],
    ["dual.ts", "export {};\n"],
  ]);
  const mains = new Map([["settings", "settings/mode.cjs"]]);
  expect([...readersOf(sources, ["settings/mode.cjs"], mains).keys()]).toEqual(["stryker.conf.cjs"]);
  expect(readersOf(sources, ["settings/mode.cjs"]).size).toBe(0);
  expect([...readersOf(sources, ["dual.js"], mains).keys()]).toEqual(["stryker.conf.cjs"]);
  expect(readersOf(sources, ["dual.ts"], mains).size).toBe(0);
});

test("a directory require depends on its manifest and on a main directory's index", () => {
  const sources = new Map([
    ["stryker.conf.cjs", 'const { ABS } = require("./settings");\nconst { other } = require("./other");\n'],
    ["settings/mode.cjs", "module.exports = {};\n"],
    ["settings/package.json", '{ "main": "mode.cjs" }\n'],
    ["other/mode/index.json", '{ "ABS": "false" }\n'],
    ["other/package.json", '{ "main": "mode" }\n'],
  ]);
  const mains = new Map([
    ["settings", "settings/mode.cjs"],
    ["other", "other/mode"],
  ]);
  expect([...readersOf(sources, ["settings/package.json"], mains).keys()]).toEqual(["stryker.conf.cjs"]);
  expect([...readersOf(sources, ["other/mode/index.json"], mains).keys()]).toEqual(["stryker.conf.cjs"]);
  expect([...readersOf(sources, ["other/package.json"], mains).keys()]).toEqual(["stryker.conf.cjs"]);
  expect([...readersOf(sources, ["settings/mode.cjs"], mains).keys()]).toEqual(["stryker.conf.cjs"]);
});

test("a directory require follows a dropped main and an invalid main to the package index", () => {
  const sources = new Map([
    ["stryker.conf.cjs", 'const { ABS } = require("./plain");\nconst { bad } = require("./broken");\n'],
    ["plain/package.json", "{}\n"],
    ["plain/index.js", "module.exports = {};\n"],
    ["broken/package.json", '{ "main": "missing.cjs" }\n'],
    ["broken/index.js", "module.exports = {};\n"],
  ]);
  const mains = new Map([
    ["plain", "plain/package.json"],
    ["broken", "broken/missing.cjs"],
  ]);
  expect([...readersOf(sources, ["plain/package.json"], mains).keys()]).toEqual(["stryker.conf.cjs"]);
  expect([...readersOf(sources, ["plain/index.js"], mains).keys()]).toEqual(["stryker.conf.cjs"]);
  expect([...readersOf(sources, ["broken/package.json"], mains).keys()]).toEqual(["stryker.conf.cjs"]);
  expect([...readersOf(sources, ["broken/index.js"], mains).keys()]).toEqual(["stryker.conf.cjs"]);
});

test("a changed file never reads as a reader of another changed file", () => {
  const sources = new Map([["tests/unit/a.test.ts", 'import { effect0 } from "../lib/effect";\n']]);

  expect(readersOf(sources, ["tests/lib/effect.ts", "tests/unit/a.test.ts"])).toEqual(new Map());
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
  const covering = coveringTests(baseline, new Set(["tests/unit/a.test.ts", "tests/unit/b.test.ts"]), mutatedBy(["src/**/*.ts", "!src/live/**"], ROOT));

  expect(covering).toEqual(
    new Map([
      ["src/covered.ts", ["tests/unit/a.test.ts", "tests/unit/b.test.ts"]],
      ["src/static.ts", ["tests/unit/a.test.ts", "tests/unit/b.test.ts"]],
    ]),
  );
});

test("a source no changed test covers or kills stays out", () => {
  expect(coveringTests(baseline, new Set(["tests/unit/c.test.ts"]), mutatedBy(["src/**/*.ts"], ROOT))).toEqual(new Map());
});

test("the lines name each list sorted and comma separated, an empty one included", () => {
  expect(envLines({ scope: ["src/b.ts", "src/a.ts"], staleTests: [] })).toBe(["SCOPE=src/a.ts,src/b.ts", "STALE_TESTS="].join("\n"));
});

test("the scope escapes each glob character in a path, and the stale tests stay literal", () => {
  const lines = envLines({ scope: ["src/routes/[id].ts", "src/{a}/(group)/*?.ts"], staleTests: ["tests/unit/[id].test.ts"] });

  expect(lines).toBe(["SCOPE=src/routes/[[]id[]].ts,src/[{]a[}]/[(]group[)]/[*][?].ts", "STALE_TESTS=tests/unit/[id].test.ts"].join("\n"));
});

test("the arguments are a base and an optional report, and nothing else", async () => {
  const parsed = (argv: readonly string[]) => Effect.runPromise(parseArgs(argv).pipe(Effect.match({ onFailure: () => "usage", onSuccess: (options) => options })));

  expect(await parsed(["abc123"])).toEqual({ base: "abc123", baseline: undefined });
  expect(await parsed(["abc123", "full/mutation.json"])).toEqual({ base: "abc123", baseline: "full/mutation.json" });
  expect(await Promise.all([[], ["--full"], ["abc123", "--json"], ["abc123", "a.json", "extra"]].map(parsed))).toEqual(["usage", "usage", "usage", "usage"]);
});
