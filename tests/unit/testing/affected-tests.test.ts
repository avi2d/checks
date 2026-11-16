import { expect, test } from "bun:test";
import {
  narrowLocalTests,
  narrowTests,
  refuseReachMap,
  sharedReason,
  staleReachPatterns,
  type Repository,
} from "../../../src/testing/affected-tests.ts";

function repository(sources: Readonly<Record<string, string>>, extra: Partial<Repository> = {}): Repository {
  return { files: Object.keys(sources), sources: new Map(Object.entries(sources)), bins: new Map(), self: undefined, preloads: [], reach: [], ...extra };
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

const LOCAL_TESTS = ["tests/e2e/checkout.test.ts", "tests/unit/cart.test.ts", "tests/unit/price.test.ts", "tests/unit/tax.test.ts"];
const SHOP_SOURCES = {
  "src/price.ts": "export const price = 1;\n",
  "src/cart.ts": 'import { price } from "./price.ts";\nexport const cart = price;\n',
  "src/tax.ts": "export const tax = 2;\n",
  "tests/lib/money.ts": "export const money = 3;\n",
  "tests/e2e/checkout.test.ts": 'import { cart } from "../../src/cart.ts";\n',
  "tests/unit/cart.test.ts": 'import { cart } from "../../src/cart.ts";\n',
  "tests/unit/price.test.ts": 'import { price } from "../../src/price.ts";\n',
  "tests/unit/tax.test.ts": 'import { tax } from "../../src/tax.ts";\nimport { money } from "../lib/money.ts";\n',
};
const SHOP = repository(SHOP_SOURCES, { files: [...Object.keys(SHOP_SOURCES), "bun.lock"] });

test("a local change to a source runs the unit and e2e tests that reach it, rather than the whole unit tier", () => {
  expect(narrowLocalTests(["src/price.ts"], SHOP, LOCAL_TESTS)).toEqual({
    kind: "files",
    files: ["tests/e2e/checkout.test.ts", "tests/unit/cart.test.ts", "tests/unit/price.test.ts"],
    shared: [],
  });
});

test("a local change to a test file runs that file alone, not the tests beside it", () => {
  expect(narrowLocalTests(["tests/unit/price.test.ts"], SHOP, LOCAL_TESTS)).toEqual({
    kind: "files",
    files: ["tests/unit/price.test.ts"],
    shared: [],
  });
});

test("a local change to a shared file runs only the tests the change reaches and names the shared file, rather than the whole suite", () => {
  expect(narrowLocalTests(["bun.lock", "src/tax.ts"], SHOP, LOCAL_TESTS)).toEqual({
    kind: "files",
    files: ["tests/unit/tax.test.ts"],
    shared: [{ path: "bun.lock", reason: "a lockfile" }],
  });
  expect(narrowLocalTests(["tests/lib/money.ts"], SHOP, LOCAL_TESTS)).toEqual({
    kind: "files",
    files: ["tests/unit/tax.test.ts"],
    shared: [{ path: "tests/lib/money.ts", reason: "a test helper" }],
  });
});

test("no local change runs no test rather than the whole suite", () => {
  expect(narrowLocalTests([], SHOP, LOCAL_TESTS)).toEqual({ kind: "files", files: [], shared: [] });
});

const SITE_TESTS = ["tests/e2e/hero.test.ts", "tests/e2e/menu.test.ts", "tests/e2e/footer.test.ts"];
const SITE_SOURCES = {
  "src/components/Hero.astro": "<section></section>\n",
  "src/components/Footer.astro": "<footer></footer>\n",
  "src/styles/hero.css": ".hero {}\n",
  "src/styles/menu.css": ".menu {}\n",
  "src/styles/tokens.css": ":root {}\n",
  "tests/e2e/hero.test.ts": "export {};\n",
  "tests/e2e/menu.test.ts": "export {};\n",
  "tests/e2e/footer.test.ts": "export {};\n",
};
const SITE = repository(SITE_SOURCES, {
  files: [...Object.keys(SITE_SOURCES), "bun.lock", "astro.config.ts"],
  reach: [
    { changed: "src/{components/Hero.astro,styles/hero.css}", tests: ["tests/e2e/hero.test.ts"] },
    { changed: "src/styles/menu.css", tests: ["tests/e2e/menu.test.ts", "tests/e2e/hero.test.ts"] },
    { changed: "src/components/Footer.astro", tests: ["tests/e2e/foot*.test.ts"] },
    { changed: "{bun.lock,astro.config.ts}", tests: ["tests/e2e/hero.test.ts"] },
  ],
});

test("a stylesheet the site's reach map names runs the tests the map gives it, not the whole suite", () => {
  expect(narrowTests(["src/styles/hero.css"], SITE, SITE_TESTS)).toEqual({ kind: "files", files: ["tests/e2e/hero.test.ts"] });
  expect(narrowTests(["src/styles/menu.css", "src/styles/hero.css"], SITE, SITE_TESTS)).toEqual({
    kind: "files",
    files: ["tests/e2e/hero.test.ts", "tests/e2e/menu.test.ts"],
  });
});

test("a component no test imports runs the tests the reach map gives it, matched by glob, rather than no test", () => {
  expect(narrowTests(["src/components/Hero.astro"], SITE, SITE_TESTS)).toEqual({ kind: "files", files: ["tests/e2e/hero.test.ts"] });
  expect(narrowTests(["src/components/Footer.astro"], SITE, SITE_TESTS)).toEqual({ kind: "files", files: ["tests/e2e/footer.test.ts"] });
});

test("a stylesheet the reach map does not name still runs the whole suite beside a mapped one", () => {
  expect(narrowTests(["src/styles/hero.css", "src/styles/tokens.css"], SITE, SITE_TESTS)).toEqual({
    kind: "full",
    because: "the pull request changes src/styles/tokens.css, a stylesheet",
  });
});

test("a lockfile or a config the reach map names still runs the whole suite rather than the mapped tests", () => {
  expect(narrowTests(["bun.lock"], SITE, SITE_TESTS)).toEqual({ kind: "full", because: "the pull request changes bun.lock, a lockfile" });
  expect(narrowTests(["astro.config.ts"], SITE, SITE_TESTS).kind).toBe("full");
});

test("a local change to a mapped stylesheet runs its mapped tests and leaves nothing to the pull request's whole run", () => {
  expect(narrowLocalTests(["src/styles/menu.css"], SITE, SITE_TESTS)).toEqual({
    kind: "files",
    files: ["tests/e2e/hero.test.ts", "tests/e2e/menu.test.ts"],
    shared: [],
  });
});

test("a reach map test pattern that matches no test file is reported stale rather than dropping its tests silently", () => {
  expect(staleReachPatterns(SITE)).toEqual([]);
  const renamed = { ...SITE, reach: [...SITE.reach, { changed: "src/styles/menu.css", tests: ["tests/e2e/nav.test.ts"] }] };
  expect(staleReachPatterns(renamed)).toEqual([{ changed: "src/styles/menu.css", pattern: "tests/e2e/nav.test.ts" }]);
});

test("a stale reach value runs the whole suite rather than narrowing to its mapped tests", () => {
  const renamed = { ...SITE, reach: [...SITE.reach, { changed: "src/styles/menu.css", tests: ["tests/e2e/nav.test.ts"] }] };
  expect(narrowTests(["src/styles/hero.css"], renamed, SITE_TESTS)).toEqual({
    kind: "full",
    because: "checks.config.ts reach names tests/e2e/nav.test.ts for src/styles/menu.css, which matches no test file",
  });
});

test("a stale reach value runs the whole local suite rather than failing the desk run", () => {
  const renamed = { ...SITE, reach: [...SITE.reach, { changed: "src/styles/menu.css", tests: ["tests/e2e/nav.test.ts"] }] };
  expect(narrowLocalTests(["src/styles/menu.css"], renamed, SITE_TESTS)).toEqual({
    kind: "full",
    because: "checks.config.ts reach names tests/e2e/nav.test.ts for src/styles/menu.css, which matches no test file",
  });
});

test("an empty reach list is refused rather than running no test", () => {
  expect(refuseReachMap({ "src/styles/print.css": [] })).toBe("checks.config.ts reach lists no test file for src/styles/print.css");
});

test("an empty reach key is refused rather than vanishing silently", () => {
  expect(refuseReachMap({ "": ["tests/e2e/x.test.ts"] })).toBe("checks.config.ts reach has an empty changed-path key");
});
