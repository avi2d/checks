import { BunServices } from "@effect/platform-bun";
import { afterEach, expect, test } from "bun:test";
import { Effect } from "effect";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { reachedRoutes } from "../../../src/quality/browser/route-scope.ts";
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
  expect(await selected(root, ["src/home.ts"])).toEqual(new Set(["/"]));
});

test("a path mapped to no routes reaches no route instead of running every route", async () => {
  const root = await rootWith('{ "src/home.ts": ["/"], "tests/unit/home.test.ts": [] }');
  expect(await selected(root, ["src/home.ts", "tests/unit/home.test.ts"])).toEqual(new Set(["/"]));
  expect(await selected(root, ["tests/unit/home.test.ts"])).toEqual(new Set([]));
});

test("an unmapped path widens instead of narrowing to the mapped route", async () => {
  const root = await rootWith('{ "src/home.ts": ["/"] }');
  expect(await selected(root, ["src/home.ts", "src/new.ts"])).toBeUndefined();
});

test("an unknown route widens instead of narrowing to it", async () => {
  const root = await rootWith('{ "src/home.ts": ["/missing/"] }');
  expect(await selected(root, ["src/home.ts"])).toBeUndefined();
});

test("an empty change widens instead of reaching no route", async () => {
  const root = await rootWith('{ "src/home.ts": ["/"] }');
  expect(await selected(root, [])).toBeUndefined();
});

test("a missing map widens instead of narrowing", async () => {
  const dir = await mkdtemp(join(tmpdir(), "checks-route-scope-"));
  dirs.push(dir);
  await writeFile(join(dir, "checks.config.ts"), "export default {};\n");
  expect(await selected(dir, ["src/home.ts"])).toBeUndefined();
});
