import { Console, Effect, Path } from "effect";
import { importedFile, resolved } from "../core/imports.ts";
import { isRecord, parseTypeScript, stringValue } from "../core/swc.ts";

type Import = { readonly specifier: string; readonly dynamic: boolean };
type Imports = { readonly imports: readonly Import[]; readonly uncertain: boolean };
type Graph = { readonly readers: Map<string, Set<string>>; readonly dynamic: Set<string> };

function callImport(node: Readonly<Record<string, unknown>>): Import | "uncertain" | undefined {
  const callee = node["callee"];
  if (node["type"] !== "CallExpression" || !isRecord(callee)) return undefined;
  if (callee["type"] !== "Import" && !(callee["type"] === "Identifier" && callee["value"] === "require")) return undefined;
  const args = node["arguments"];
  const first = Array.isArray(args) ? args[0] : undefined;
  const specifier = isRecord(first) ? stringValue(first["expression"]) : undefined;
  return specifier === undefined ? "uncertain" : { specifier, dynamic: callee["type"] === "Import" };
}

function nodeImport(node: Readonly<Record<string, unknown>>): Import | "uncertain" | undefined {
  if (["ImportDeclaration", "ExportAllDeclaration", "ExportNamedDeclaration"].includes(String(node["type"]))) {
    const specifier = stringValue(node["source"]);
    return specifier === undefined ? undefined : { specifier, dynamic: false };
  }
  return callImport(node);
}

function readImports(node: unknown): Imports {
  const imports: Import[] = [];
  let uncertain = false;
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) return value.forEach(visit);
    if (!isRecord(value)) return;
    const found = nodeImport(value);
    if (found === "uncertain") uncertain = true;
    else if (found !== undefined) imports.push(found);
    Object.values(value).forEach(visit);
  };
  visit(node);
  return { imports, uncertain };
}

const resolveTargets = Effect.fn("resolveTargets")(function* (root: string, file: string, specifier: string, known: ReadonlySet<string>) {
  const directory = file.slice(0, file.lastIndexOf("/"));
  if (specifier.startsWith(".")) return importedFile(resolved(directory, specifier), known);
  if (specifier.startsWith("node:") || specifier.startsWith("bun:")) return [];
  const path = yield* Path.Path;
  const target = yield* Effect.tryPromise({ try: () => Bun.resolve(specifier, path.join(root, directory)), catch: () => undefined }).pipe(Effect.orElseSucceed(() => ""));
  if (target === "") return undefined;
  const relative = path.relative(root, target);
  return known.has(relative) ? [relative] : [];
});

const addSource = Effect.fn("addSource")(function* (root: string, file: string, source: string, known: ReadonlySet<string>, graph: Graph) {
  const found = readImports(yield* parseTypeScript(file, source));
  if (found.uncertain) return false;
  for (const item of found.imports) {
    const targets = yield* resolveTargets(root, file, item.specifier, known);
    if (targets === undefined || (item.specifier.startsWith(".") && targets.length === 0)) return false;
    for (const target of targets) {
      if (item.dynamic) graph.dynamic.add(target);
      else graph.readers.set(target, (graph.readers.get(target) ?? new Set()).add(file));
    }
  }
  return true;
});

function reachedFrom(changed: readonly string[], readers: ReadonlyMap<string, ReadonlySet<string>>): ReadonlySet<string> {
  const reached = new Set<string>();
  const pending = [...changed];
  while (pending.length > 0) {
    const file = pending.pop();
    if (file === undefined || reached.has(file)) continue;
    reached.add(file);
    pending.push(...(readers.get(file) ?? []));
  }
  return reached;
}

export const reportImpact = Effect.fn("reportImpact")(function* (byChange: ReadonlyMap<string, readonly string[]>) {
  for (const [path, reached] of byChange) {
    for (const test of reached.length === 0 ? ["no test file"] : reached) yield* Console.log(`checks-test: ${path} -> ${test}`);
  }
});

function unparsedMayReach(sources: ReadonlyMap<string, string>, reached: ReadonlySet<string>): boolean {
  const names = [...reached].flatMap((file) => [file, (file.split("/").pop() ?? "").replace(/\.(?:[cm]?[jt]sx?)$/, "")]).filter(Boolean);
  return [...sources].some(([file, text]) => !/\.(?:[cm]?[jt]sx?)$/.test(file)
    && (/\b(?:import|require)\s*\(/.test(text) || names.some((name) => text.includes(name))));
}

export const helperImpact = Effect.fn("helperImpact")(function* (root: string, changed: readonly string[], sources: ReadonlyMap<string, string>, files: readonly string[]) {
  const known = new Set(files);
  const graph: Graph = { readers: new Map(), dynamic: new Set() };
  for (const [file, source] of sources) {
    if (!/\.(?:[cm]?[jt]sx?)$/.test(file)) continue;
    if (!(yield* addSource(root, file, source, known, graph))) return undefined;
  }
  const reached = reachedFrom(changed, graph.readers);
  return [...graph.dynamic].some((target) => reached.has(target)) || unparsedMayReach(sources, reached) ? undefined : reached;
});
