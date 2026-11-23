import { Effect, FileSystem, Path } from "effect";
import { workingTreeFiles } from "../../core/git.ts";
import { importsOf } from "../../core/imports.ts";
import { BrowserRoutes, decodeSetting, loadSettings } from "../../core/settings.ts";
import type { Declaration } from "./declaration.ts";

type RouteMap = typeof BrowserRoutes.Type;

type Fallback = { readonly kind: "full"; readonly because: string };

export type RouteScope = Fallback | { readonly kind: "routes"; readonly routes: ReadonlySet<string> };

const SOURCE_FILE = /\.(?:[cm]?[jt]sx?|astro|svelte|vue|mdx)$/;
const TEST_TREE = "tests/";

function importersOf(sources: ReadonlyMap<string, string>, changed: readonly string[]): ReadonlyMap<string, readonly string[]> {
  const known = new Set([...sources.keys(), ...changed]);
  const importers = new Map<string, string[]>();
  for (const [file, text] of sources) {
    for (const imported of importsOf(file, text, known)) importers.set(imported, [...(importers.get(imported) ?? []), file]);
  }
  return importers;
}

// An unmapped importer that nothing imports renders where no route is known, so it places the path nowhere.
function placed(path: string, map: RouteMap, importers: ReadonlyMap<string, readonly string[]>): Fallback | { readonly kind: "placed"; readonly routes: readonly string[] } {
  const routes: string[] = [];
  const seen = new Set<string>();
  let mapped = false;
  const pending = [path];
  for (let node = pending.pop(); node !== undefined; node = pending.pop()) {
    if (seen.has(node)) continue;
    seen.add(node);
    if (Object.hasOwn(map, node)) {
      mapped = true;
      routes.push(...(map[node] ?? []));
      continue;
    }
    const next = importers.get(node) ?? [];
    if (next.length === 0 && node !== path) return { kind: "full", because: `${path} reaches ${node}, which has no browserRoutes mapping` };
    pending.push(...next);
  }
  return mapped ? { kind: "placed", routes } : { kind: "full", because: `${path} has no browserRoutes mapping and no mapped file imports it` };
}

export function scopeRoutes(changed: readonly string[], map: RouteMap, sources: ReadonlyMap<string, string>, declaration: Declaration): RouteScope {
  const importers = importersOf(sources, changed);
  const routes: string[] = [];
  for (const path of changed) {
    const placement = placed(path, map, importers);
    if (placement.kind === "full") return placement;
    routes.push(...placement.routes);
  }
  const declared = new Set(declaration.routes.map(({ path }) => path));
  const unknown = routes.find((path) => !declared.has(path));
  if (unknown !== undefined) return { kind: "full", because: `browserRoutes names undeclared route ${unknown}` };
  return { kind: "routes", routes: new Set(routes) };
}

const readSources = Effect.fn("readSources")(function* (root: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const files = (yield* workingTreeFiles(root)).filter((file) => SOURCE_FILE.test(file) && !file.startsWith(TEST_TREE));
  return new Map(yield* Effect.forEach(files, (file) =>
    fs.readFileString(path.join(root, file)).pipe(Effect.map((text) => [file, text] as const)), { concurrency: 16 }));
});

export const reachedRoutes = Effect.fn("reachedRoutes")(function* (root: string, changed: readonly string[], declaration: Declaration) {
  if (changed.length === 0) return { kind: "full", because: "the pull request changes no file" } satisfies RouteScope;
  const raw = (yield* loadSettings(root))["browserRoutes"];
  if (raw === undefined) return { kind: "full", because: "browserRoutes is not configured" } satisfies RouteScope;
  const map = yield* decodeSetting("browserRoutes", BrowserRoutes, raw);
  const sources = changed.every((path) => Object.hasOwn(map, path)) ? new Map<string, string>() : yield* readSources(root);
  return scopeRoutes(changed, map, sources, declaration);
});
