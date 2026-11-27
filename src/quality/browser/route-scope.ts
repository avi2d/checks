import { Console, Effect, FileSystem, Path } from "effect";
import { workingTreeFiles } from "../../core/git.ts";
import { importsOf, TEST_TREE } from "../../core/imports.ts";
import { BROWSER_SETTINGS_FILE, type AffectedRoutes } from "../../core/browser-settings.ts";
import { SETTINGS_FILE } from "../../core/settings.ts";
import { pullRequestReason, testEnvironmentReason, TEST_FILE } from "../../core/test-impact.ts";
import { readAffectedRoutes } from "./config-reader.ts";
import type { Declaration } from "./declaration.ts";

type Fallback = { readonly kind: "full"; readonly because: string };

type RouteMap = { readonly value: AffectedRoutes; readonly location: string };

export type RouteScope = Fallback | { readonly kind: "routes"; readonly routes: ReadonlySet<string> };

type RouteImpact = Fallback | { readonly kind: "routes"; readonly byChange: ReadonlyMap<string, readonly string[]>; readonly location: string | undefined };

function fullRouteReason(changed: readonly string[]): string | undefined {
  if (changed.length === 0) return "the pull request changes no file";
  for (const path of changed) {
    const reason = testEnvironmentReason(path);
    if (reason !== undefined) return pullRequestReason(path, reason);
  }
  return undefined;
}

const SOURCE_FILE = /\.(?:[cm]?[jt]sx?|astro|svelte|vue|mdx?|css|scss|sass|less|html)$/;
const QUOTES = ['"', "'", "`"];

function importersOf(sources: ReadonlyMap<string, string>, changed: readonly string[]): ReadonlyMap<string, readonly string[]> {
  const known = new Set([...sources.keys(), ...changed]);
  const importers = new Map<string, string[]>();
  for (const [file, text] of sources) {
    for (const imported of importsOf(file, text, known)) importers.set(imported, [...(importers.get(imported) ?? []), file]);
  }
  return importers;
}

function namesPath(text: string, path: string): boolean {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const stem = name.replace(/\.[^.]*$/, "");
  const stems = stem.startsWith("_") ? [stem, stem.slice(1)] : [stem];
  return ["/", ...QUOTES, "("].some((prefix) =>
    text.includes(`${prefix}${name}`) || stems.some((part) => QUOTES.some((quote) => text.includes(`${prefix}${part}${quote}`))),
  );
}

// Relative edges miss an alias, a root path or frontmatter, so a file that names the path any other way may still render it.
function strayNamer(node: string, sources: ReadonlyMap<string, string>, importers: readonly string[]): string | undefined {
  for (const [file, text] of sources) {
    if (file !== node && !importers.includes(file) && namesPath(text, node)) return file;
  }
  return undefined;
}

function indirectImportReason(path: string, node: string, importer: string): string {
  return node === path
    ? `${importer} names ${path} outside a relative import`
    : `${path} reaches ${node}, which ${importer} names outside a relative import`;
}

// An unmapped importer that nothing imports renders where no route is known, so it places the path nowhere.
function unmappedPlacement(test: boolean): Fallback | { readonly kind: "placed"; readonly routes: readonly string[] } {
  if (test) return { kind: "placed", routes: [] };
  return { kind: "full", because: `no affectedRoutes is set in ${BROWSER_SETTINGS_FILE}` };
}

function placed(path: string, map: RouteMap | undefined, sources: ReadonlyMap<string, string>, importers: ReadonlyMap<string, readonly string[]>): Fallback | { readonly kind: "placed"; readonly routes: readonly string[] } {
  const test = path.startsWith(TEST_TREE) && TEST_FILE.test(path);
  if (map === undefined) return unmappedPlacement(test);
  const routes: string[] = [];
  const seen = new Set<string>();
  let mapped = false;
  const pending = [path];
  for (let node = pending.pop(); node !== undefined; node = pending.pop()) {
    if (seen.has(node)) continue;
    seen.add(node);
    if (Object.hasOwn(map.value, node)) {
      mapped = true;
      routes.push(...(map.value[node] ?? []));
      continue;
    }
    const next = importers.get(node) ?? [];
    const stray = strayNamer(node, sources, next);
    if (stray !== undefined) return { kind: "full", because: indirectImportReason(path, node, stray) };
    if (next.length === 0 && node !== path) return { kind: "full", because: `${path} reaches ${node}, which has no mapping in ${map.location}` };
    pending.push(...next);
  }
  if (mapped || test) return { kind: "placed", routes };
  return { kind: "full", because: `${path} has no mapping in ${map.location} and no mapped file imports it` };
}

function routeImpact(changed: readonly string[], map: RouteMap | undefined, sources: ReadonlyMap<string, string>): RouteImpact {
  const importers = importersOf(sources, changed);
  const byChange = new Map<string, readonly string[]>();
  for (const path of changed) {
    const placement = placed(path, map, sources, importers);
    if (placement.kind === "full") return placement;
    byChange.set(path, [...new Set(placement.routes)]);
  }
  return { kind: "routes", byChange, location: map?.location };
}

function scoped(impact: RouteImpact, declaration: { readonly routes: Declaration["routes"] }): RouteScope {
  if (impact.kind === "full") return impact;
  const routes = new Set([...impact.byChange.values()].flat());
  const declared = new Set(declaration.routes.map(({ path }) => path));
  const unknown = [...routes].find((path) => !declared.has(path));
  if (unknown !== undefined) return { kind: "full", because: `${impact.location ?? BROWSER_SETTINGS_FILE} names undeclared route ${unknown}` };
  return { kind: "routes", routes };
}

export function scopeRoutes(changed: readonly string[], map: RouteMap, sources: ReadonlyMap<string, string>, declaration: Declaration): RouteScope {
  return scoped(routeImpact(changed, map, sources), declaration);
}

const readSources = Effect.fn("readSources")(function* (root: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const files = (yield* workingTreeFiles(root)).filter((file) => SOURCE_FILE.test(file) && file !== SETTINGS_FILE && file !== BROWSER_SETTINGS_FILE && !file.startsWith(TEST_TREE));
  return new Map(yield* Effect.forEach(files, (file) =>
    fs.readFileString(path.join(root, file)).pipe(Effect.map((text) => [file, text] as const)), { concurrency: 16 }));
});

export const readRouteImpact = Effect.fn("readRouteImpact")(function* (root: string, changed: readonly string[]) {
  const because = fullRouteReason(changed);
  if (because !== undefined) return { kind: "full", because } satisfies Fallback;
  const map = yield* readAffectedRoutes(root);
  const sources = map === undefined || changed.every((path) => Object.hasOwn(map.value, path)) ? new Map<string, string>() : yield* readSources(root);
  return routeImpact(changed, map, sources);
});

export const reachedRoutes = Effect.fn("reachedRoutes")(function* (root: string, changed: readonly string[], declaration: Declaration) {
  const impact = yield* readRouteImpact(root, changed);
  const selection = scoped(impact, declaration);
  if (impact.kind === "routes" && selection.kind === "routes") {
    for (const [file, routes] of impact.byChange) {
      for (const route of routes) yield* Console.log(`browser: ${file} -> ${route}`);
    }
  }
  return selection;
});
