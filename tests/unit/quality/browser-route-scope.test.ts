import { BunServices } from "@effect/platform-bun";
import { afterEach, expect, test } from "bun:test";
import { Effect } from "effect";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { reachedRoutes, scopeRoutes } from "../../../src/quality/browser/route-scope.ts";
import type { Declaration } from "../../../src/quality/browser/declaration.ts";

const declaration: Declaration = {
  site: "dist",
  routes: [
    { path: "/", locale: "en" },
    { path: "/other/", locale: "en" },
  ],
  viewports: [{ name: "phone", width: 320, height: 640 }],
  states: [{ name: "default" }],
  targets: [{ name: "main", selector: "main" }],
  checks: ["html"],
};

const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

async function rootWith(routes: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "checks-route-scope-"));
  dirs.push(dir);
  await writeFile(join(dir, "checks.config.ts"), `export default { browserRoutes: ${routes} };
`);
  return dir;
}

function selected(root: string, changed: readonly string[]) {
  return Effect.runPromise(reachedRoutes(root, changed, declaration).pipe(Effect.provide(BunServices.layer)));
}

test("a mapped path narrows to its route instead of running every route", async () => {
  const root = await rootWith('{ "src/home.ts": ["/"] }');
  expect(await selected(root, ["src/home.ts"])).toEqual({ kind: "routes", routes: new Set(["/"]) });
});

test("a path mapped to no routes reaches no route instead of running every route", async () => {
  const root = await rootWith('{ "src/home.ts": ["/"], "tests/unit/home.test.ts": [] }');
  expect(await selected(root, ["src/home.ts", "tests/unit/home.test.ts"])).toEqual({ kind: "routes", routes: new Set(["/"]) });
  expect(await selected(root, ["tests/unit/home.test.ts"])).toEqual({ kind: "routes", routes: new Set([]) });
});

const pages = { "src/pages/index.astro": ["/"], "src/pages/other.astro": ["/other/"] };

test("an unmapped path no mapped file imports widens instead of narrowing to the mapped route", () => {
  const sources = new Map([["src/home.ts", ""], ["src/new.ts", ""]]);
  expect(scopeRoutes(["src/home.ts", "src/new.ts"], { "src/home.ts": ["/"] }, sources, declaration))
    .toEqual({ kind: "full", because: "src/new.ts has no browserRoutes mapping and no mapped file imports it" });
});

test("an unmapped component narrows to the route of the page that imports it instead of walking every route", () => {
  const sources = new Map([
    ["src/pages/index.astro", '---\nimport Card from "../components/Card.astro";\n---\n<Card />\n'],
    ["src/pages/other.astro", "<p>other</p>\n"],
    ["src/components/Card.astro", "<div>card</div>\n"],
  ]);
  expect(scopeRoutes(["src/components/Card.astro"], pages, sources, declaration)).toEqual({ kind: "routes", routes: new Set(["/"]) });
});

test("a component a mapped page imports through an unmapped one narrows instead of walking every route", () => {
  const sources = new Map([
    ["src/pages/index.astro", '---\nimport Section from "../components/Section.astro";\n---\n<Section />\n'],
    ["src/pages/other.astro", "<p>other</p>\n"],
    ["src/components/Section.astro", '---\nimport Card from "./Card.astro";\n---\n<Card />\n'],
    ["src/components/Card.astro", "<div>card</div>\n"],
  ]);
  expect(scopeRoutes(["src/components/Card.astro"], pages, sources, declaration)).toEqual({ kind: "routes", routes: new Set(["/"]) });
});

test("an unmapped page that imports the component widens instead of narrowing to the mapped page", () => {
  const sources = new Map([
    ["src/pages/index.astro", '---\nimport Card from "../components/Card.astro";\n---\n<Card />\n'],
    ["src/pages/about.astro", '---\nimport Card from "../components/Card.astro";\n---\n<Card />\n'],
    ["src/components/Card.astro", "<div>card</div>\n"],
  ]);
  expect(scopeRoutes(["src/components/Card.astro"], pages, sources, declaration))
    .toEqual({ kind: "full", because: "src/components/Card.astro reaches src/pages/about.astro, which has no browserRoutes mapping" });
});

test("a component one page imports through a tsconfig alias widens instead of narrowing to the relative importer", () => {
  const sources = new Map([
    ["src/pages/index.astro", '---\nimport Card from "../components/Card.astro";\n---\n<Card />\n'],
    ["src/pages/other.astro", '---\nimport Card from "@/components/Card.astro";\n---\n<Card />\n'],
    ["src/components/Card.astro", "<div>card</div>\n"],
  ]);
  expect(scopeRoutes(["src/components/Card.astro"], pages, sources, declaration))
    .toEqual({ kind: "full", because: "src/pages/other.astro names src/components/Card.astro outside a relative import" });
});

test("a bare sibling stylesheet import widens instead of omitting the other route", () => {
  const sources = new Map([
    ["src/pages/index.astro", 'import "../styles/tokens.css";'],
    ["src/pages/other.astro", 'import "../styles/global.css";'],
    ["src/styles/global.css", '@import "tokens.css";'],
    ["src/styles/tokens.css", ""],
  ]);
  expect(scopeRoutes(["src/styles/tokens.css"], pages, sources, declaration))
    .toEqual({ kind: "full", because: "src/styles/global.css names src/styles/tokens.css outside a relative import" });
});

test("a Sass partial named without its underscore widens instead of omitting the other route", () => {
  const sources = new Map([
    ["src/pages/index.astro", 'import "../styles/_vars.scss";'],
    ["src/pages/other.astro", 'import "../styles/global.scss";'],
    ["src/styles/global.scss", '@use "vars";'],
    ["src/styles/_vars.scss", ""],
  ]);
  expect(scopeRoutes(["src/styles/_vars.scss"], pages, sources, declaration))
    .toEqual({ kind: "full", because: "src/styles/global.scss names src/styles/_vars.scss outside a relative import" });
});

test("a component an unmapped one reaches through an alias widens instead of narrowing to the relative importer", () => {
  const sources = new Map([
    ["src/pages/index.astro", '---\nimport Section from "../components/Section.astro";\n---\n<Section />\n'],
    ["src/pages/other.astro", '---\nimport Section from "@/components/Section";\n---\n<Section />\n'],
    ["src/components/Section.astro", '---\nimport Card from "./Card.astro";\n---\n<Card />\n'],
    ["src/components/Card.astro", "<div>card</div>\n"],
  ]);
  expect(scopeRoutes(["src/components/Card.astro"], pages, sources, declaration))
    .toEqual({ kind: "full", because: "src/components/Card.astro reaches src/components/Section.astro, which src/pages/other.astro names outside a relative import" });
});

test("an unknown route widens instead of narrowing to it", async () => {
  const root = await rootWith('{ "src/home.ts": ["/missing/"] }');
  expect(await selected(root, ["src/home.ts"])).toEqual({ kind: "full", because: "browserRoutes names undeclared route /missing/" });
});

test("an unconnected test beside a mapped component does not widen to every route", () => {
  const sources = new Map([["src/pages/index.astro", 'import "../home.ts";']]);
  expect(scopeRoutes(["tests/unit/home.test.ts", "src/home.ts"], pages, sources, declaration)).toEqual({ kind: "routes", routes: new Set(["/"]) });
});

test("a workflow change widens instead of trusting an empty route map entry", async () => {
  const root = await rootWith('{ ".github/workflows/ci.yml": [] }');
  expect(await selected(root, [".github/workflows/ci.yml"])).toEqual({
    kind: "full", because: "the pull request changes .github/workflows/ci.yml, CI wiring",
  });
});

test("an empty change widens instead of reaching no route", async () => {
  const root = await rootWith('{ "src/home.ts": ["/"] }');
  expect(await selected(root, [])).toEqual({ kind: "full", because: "the pull request changes no file" });
});

test("a missing map widens instead of narrowing", async () => {
  const dir = await mkdtemp(join(tmpdir(), "checks-route-scope-"));
  dirs.push(dir);
  await writeFile(join(dir, "checks.config.ts"), "export default {};\n");
  expect(await selected(dir, ["src/home.ts"])).toEqual({ kind: "full", because: "browserRoutes is not configured" });
});

