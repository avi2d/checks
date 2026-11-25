import { Console, Effect, Path } from "effect";
import { importedFile, importsOf, resolved } from "../core/imports.ts";
import { isRecord, parseTypeScript, stringValue } from "../core/swc.ts";

type Import = { readonly specifier: string };
type Imports = { readonly imports: readonly Import[]; readonly uncertain: boolean };

function callImport(node: Readonly<Record<string, unknown>>): Import | "uncertain" | undefined {
  const callee = node["callee"];
  if (node["type"] !== "CallExpression" || !isRecord(callee)) return undefined;
  if (callee["type"] !== "Import" && !(callee["type"] === "Identifier" && callee["value"] === "require")) return undefined;
  const args = node["arguments"];
  const first = Array.isArray(args) ? args[0] : undefined;
  const specifier = isRecord(first) ? stringValue(first["expression"]) : undefined;
  return specifier === undefined ? "uncertain" : { specifier };
}

function nodeImport(node: Readonly<Record<string, unknown>>): Import | "uncertain" | undefined {
  if (["ImportDeclaration", "ExportAllDeclaration", "ExportNamedDeclaration"].includes(String(node["type"]))) {
    const specifier = stringValue(node["source"]);
    return specifier === undefined ? undefined : { specifier };
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
  const directory = file.slice(0, Math.max(file.lastIndexOf("/"), 0));
  if (specifier.includes(":")) return [];
  if (specifier.startsWith(".")) return importedFile(resolved(directory, specifier), known);
  const path = yield* Path.Path;
  const target = yield* Effect.tryPromise({ try: () => Bun.resolve(specifier, path.join(root, directory)), catch: () => undefined }).pipe(Effect.orElseSucceed(() => ""));
  if (target === "") return undefined;
  const relative = path.relative(root, target);
  return known.has(relative) ? [relative] : [];
});

const addSource = Effect.fn("addSource")(function* (root: string, file: string, source: string, known: ReadonlySet<string>, readers: Map<string, Set<string>>) {
  const found = readImports(yield* parseTypeScript(file, source));
  if (found.uncertain) return false;
  for (const item of found.imports) {
    const targets = yield* resolveTargets(root, file, item.specifier, known);
    if (targets === undefined || (item.specifier.startsWith(".") && targets.length === 0)) return false;
    for (const target of targets) {
      readers.set(target, (readers.get(target) ?? new Set()).add(file));
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

export const helperImpact = Effect.fn("helperImpact")(function* (
  root: string,
  changed: readonly string[],
  sources: ReadonlyMap<string, string>,
  files: readonly string[],
  sourceReaders: ReadonlyMap<string, ReadonlySet<string>> = new Map(),
) {
  const known = new Set(files);
  const readers = new Map([...sourceReaders].map(([file, importing]) => [file, new Set(importing)]));
  for (const [file, source] of sources) {
    if (/\.(?:[cm]?[jt]sx?)$/.test(file)) {
      if (!(yield* addSource(root, file, source, known, readers))) return undefined;
    } else {
      if (/\b(?:import|require)\s*\((?!\s*(?:"[^"]*"|'[^']*')\s*\))/.test(source)) return undefined;
      for (const target of importsOf(file, source, known)) readers.set(target, (readers.get(target) ?? new Set()).add(file));
    }
  }
  return reachedFrom(changed, readers);
});
