export const TEST_TREE = "tests/";

const CANDIDATE_EXTENSIONS = [".tsx", ".ts", ".mts", ".cts", ".jsx", ".js", ".mjs", ".cjs", ".json", ".node"];

const IMPORT = /(?:from|import)\s*\(?\s*["'](\.[^"']*)["']|require\s*\(\s*["'](\.[^"']*)["']\s*\)/g;

export function resolved(directory: string, spec: string): string {
  const parts: string[] = [];
  for (const part of `${directory}/${spec}`.split("/")) {
    if (part === "..") parts.pop();
    else if (part !== "." && part !== "") parts.push(part);
  }
  return parts.join("/");
}

export function importPath(specifier: string): string {
  return specifier.replace(/(?!^)[?#].*$/, "");
}

// Bun takes the file a specifier names, then one with an extension added, and only then the directory's index.
export function importedFile(input: string, files: ReadonlySet<string>): readonly string[] {
  const path = importPath(input);
  const bare = path.replace(/\.m?js$/, "");
  const direct = [path, ...CANDIDATE_EXTENSIONS.map((extension) => bare + extension)].filter((file) => files.has(file));
  if (direct.length > 0) return direct;
  return CANDIDATE_EXTENSIONS.map((extension) => `${path}/index${extension}`).filter((file) => files.has(file));
}

export function importsOf(file: string, text: string, files: ReadonlySet<string>): readonly string[] {
  const directory = file.slice(0, Math.max(file.lastIndexOf("/"), 0));
  return [...text.matchAll(IMPORT)].flatMap(([, throughImport = "", throughRequire = ""]) => importedFile(resolved(directory, importPath(throughImport || throughRequire)), files));
}
