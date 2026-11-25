import { Console, Effect, FileSystem, Path, Schema } from "effect";
import { importedFile, importPath, importsOf, resolved } from "../core/imports.ts";
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
    if (node["typeOnly"] === true) return undefined;
    const specifiers = node["specifiers"];
    if (Array.isArray(specifiers) && specifiers.length > 0 && specifiers.every((item) => isRecord(item) && item["isTypeOnly"] === true)) return undefined;
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

const ImportConfig = Schema.Struct({
  extends: Schema.optionalKey(Schema.Union([Schema.String, Schema.Array(Schema.String)])),
  compilerOptions: Schema.optionalKey(Schema.Struct({
    paths: Schema.optionalKey(Schema.Record(Schema.String, Schema.Array(Schema.String))),
  })),
});
const decodeImportConfig = Schema.decodeUnknownEffect(ImportConfig);

const readAliases = Effect.fn("readAliases")(function* (root: string, files: readonly string[]) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const aliases = new Set<string>();
  const visited = new Set<string>();
  const pending = files.filter((file) => /(?:^|\/)(?:ts|js)config(?:\.[^/]+)?\.json$/.test(file)).map((file) => path.join(root, file));
  while (pending.length > 0) {
    const file = pending.pop();
    if (file === undefined || visited.has(file)) continue;
    visited.add(file);
    const text = yield* fs.readFileString(file);
    const config = yield* Effect.try({ try: (): unknown => Bun.JSONC.parse(text), catch: () => undefined }).pipe(Effect.flatMap(decodeImportConfig));
    for (const alias of Object.keys(config.compilerOptions?.paths ?? {})) aliases.add(alias);
    const inherited = config.extends === undefined ? [] : typeof config.extends === "string" ? [config.extends] : config.extends;
    for (const specifier of inherited) {
      pending.push(yield* Effect.tryPromise({ try: () => Bun.resolve(specifier, path.dirname(file)), catch: () => undefined }));
    }
  }
  return [...aliases];
});

function matchesAlias(specifier: string, alias: string): boolean {
  const wildcard = alias.indexOf("*");
  return wildcard < 0 ? specifier === alias : specifier.startsWith(alias.slice(0, wildcard)) && specifier.endsWith(alias.slice(wildcard + 1));
}

const resolveTargets = Effect.fn("resolveTargets")(function* (root: string, file: string, input: string, known: ReadonlySet<string>, aliases: readonly string[]) {
  const specifier = importPath(input);
  const directory = file.slice(0, Math.max(file.lastIndexOf("/"), 0));
  if (specifier.includes(":")) return [];
  if (specifier.startsWith(".")) {
    const targets = importedFile(resolved(directory, specifier), known);
    return targets.length === 0 ? undefined : targets;
  }
  const path = yield* Path.Path;
  const target = yield* Effect.tryPromise({ try: () => Bun.resolve(specifier, path.join(root, directory)), catch: () => undefined }).pipe(Effect.orElseSucceed(() => ""));
  if (target === "") return specifier.startsWith("#") || specifier.startsWith("/") || aliases.some((alias) => matchesAlias(specifier, alias)) ? undefined : [];
  const relative = path.relative(root, target);
  return known.has(relative) ? [relative] : [];
});

const addSource = Effect.fn("addSource")(function* (root: string, file: string, source: string, known: ReadonlySet<string>, readers: Map<string, Set<string>>, aliases: readonly string[]) {
  const found = readImports(yield* parseTypeScript(file, source));
  if (found.uncertain) return false;
  for (const item of found.imports) {
    const targets = yield* resolveTargets(root, file, item.specifier, known, aliases);
    if (targets === undefined) return false;
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
  const aliases = yield* readAliases(root, files);
  const readers = new Map([...sourceReaders].map(([file, importing]) => [file, new Set(importing)]));
  for (const [file, source] of sources) {
    if (/\.(?:[cm]?[jt]sx?)$/.test(file)) {
      if (!(yield* addSource(root, file, source, known, readers, aliases))) return undefined;
    } else {
      if (/\b(?:import|require)\s*\((?!\s*(?:"[^"]*"|'[^']*')\s*\))/.test(source)) return undefined;
      for (const target of importsOf(file, source, known)) readers.set(target, (readers.get(target) ?? new Set()).add(file));
    }
  }
  return reachedFrom(changed, readers);
});
