import { expect, test } from "bun:test";
import { narrowTests, sharedReason, type Repository } from "../../src/testing/affected-tests.ts";

function repository(sources: Readonly<Record<string, string>>, extra: Partial<Repository> = {}): Repository {
  return { files: Object.keys(sources), sources: new Map(Object.entries(sources)), bins: new Map(), self: undefined, preloads: [], ...extra };
}

const TESTS = ["tests/unit/a.test.ts", "tests/unit/b.test.ts", "tests/e2e/c.test.ts"];
const TREE = repository({
  "src/a.ts": 'export const a = 1;\n',
  "src/b.ts": 'import { a } from "./a.ts";\nexport const b = a;\n',
  "src/c.ts": 'export const c = 3;\n',
  "src/registry.ts": 'export const bins = ["src/a.ts", "src/c.ts"];\n',
  "tests/unit/a.test.ts": 'import { a } from "../../src/a.ts";\n',
  "tests/unit/b.test.ts": 'import { b } from "../../src/b.ts";\nimport { bins } from "../../src/registry.ts";\n',
  "tests/e2e/c.test.ts": 'await Bun.$`bun src/c.ts`;\n',
});

test("a change to one source runs the tests that import it directly or through another source, not every test", () => {
  expect(narrowTests(["src/a.ts"], TREE, TESTS)).toEqual({ kind: "files", files: ["tests/unit/a.test.ts", "tests/unit/b.test.ts"] });
  expect(narrowTests(["src/b.ts"], TREE, TESTS)).toEqual({ kind: "files", files: ["tests/unit/b.test.ts"] });
});

test("a test that runs a source by its path reads it, while the importer of a source that lists the path does not", () => {
  expect(narrowTests(["src/c.ts"], TREE, TESTS)).toEqual({ kind: "files", files: ["tests/e2e/c.test.ts"] });
});

test("a changed test runs itself even when no source changes", () => {
  expect(narrowTests(["tests/unit/a.test.ts"], TREE, TESTS)).toEqual({ kind: "files", files: ["tests/unit/a.test.ts"] });
});

test("a change no test reads runs no test rather than the whole suite", () => {
  expect(narrowTests(["docs/a.md"], TREE, TESTS)).toEqual({ kind: "files", files: [] });
});

test("a test that runs a bin by name reads the file the bin points at", () => {
  const tree = repository({ "src/tool.ts": "export {};\n", "tests/e2e/tool.test.ts": "await Bun.$`checks-tool --all`;\n" }, { bins: new Map([["checks-tool", "src/tool.ts"]]) });
  expect(narrowTests(["src/tool.ts"], tree, ["tests/e2e/tool.test.ts"])).toEqual({ kind: "files", files: ["tests/e2e/tool.test.ts"] });
});

test("a test that imports the package by its own name reads the file its export points at", () => {
  const tree = repository(
    { "src/index.ts": "export {};\n", "tests/unit/self.test.ts": 'import {} from "kit";\n' },
    { self: { name: "kit", exports: new Map([[".", "src/index.ts"]]) } },
  );
  expect(narrowTests(["src/index.ts"], tree, ["tests/unit/self.test.ts"])).toEqual({ kind: "files", files: ["tests/unit/self.test.ts"] });
});

test("a test that names a fixture directory reads each fixture under it", () => {
  const tree = repository({ "tests/unit/f.test.ts": 'const dir = join("tests/fixtures", "repo");\n' }, { files: ["tests/unit/f.test.ts", "tests/fixtures/repo/a.json"] });
  expect(narrowTests(["tests/fixtures/repo/a.json"], tree, ["tests/unit/f.test.ts"])).toEqual({ kind: "files", files: ["tests/unit/f.test.ts"] });
});

test("a shared file runs the whole suite, whichever test reads it", () => {
  const shared = [
    "bun.lock",
    "package.json",
    "bunfig.toml",
    "tsconfig.json",
    "vite.config.ts",
    ".bun-version",
    "tests/lib/env.ts",
    "src/styles/global.css",
    "public/fonts/inter.woff2",
    "src/layouts/Base.astro",
  ];
  for (const path of shared) expect(narrowTests(["src/a.ts", path], TREE, TESTS).kind).toBe("full");
});

test("a file Bun preloads into every test runs the whole suite, though no test imports it", () => {
  const tree = repository({ "tests/setup.ts": 'import "../src/c.ts";\n', ...Object.fromEntries(TREE.sources) }, { preloads: ["tests/setup.ts"] });
  expect(narrowTests(["src/c.ts"], tree, TESTS)).toEqual({ kind: "full", because: "the pull request changes src/c.ts, a file Bun preloads into every test" });
});

test("a workflow is not a shared file, since the suite does not run under it", () => {
  expect(sharedReason(".github/workflows/ci.yml", new Set())).toBeUndefined();
});

test("a fixture under tests is data, not a test helper that would run the whole suite", () => {
  expect(sharedReason("tests/fixtures/repo/package.json", new Set())).toBeUndefined();
});

test("a pull request that changes no file runs the whole suite rather than nothing", () => {
  expect(narrowTests([], TREE, TESTS).kind).toBe("full");
});
