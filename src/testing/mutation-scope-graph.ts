export const TEST_TREE = "tests/";
const FIXTURES = "tests/fixtures/";
const CANDIDATE_EXTENSIONS = [".tsx", ".ts", ".mts", ".cts", ".jsx", ".js", ".mjs", ".cjs", ".json", ".node"];

const IMPORT = /(?:from|import)\s*\(?\s*["'](\.[^"']*)["']|require\s*\(\s*["'](\.[^"']*)["']\s*\)/g;
const LISTED_SEGMENTS = /["'`][ \t]*,[ \t]*["'`]/g;
const DIRECTORY_ENDS = ['"', "'", "`", '/"', "/'", "/`", "/${"];

type Needle = { readonly text: string; readonly kind: "file" | "directory"; readonly fixture: string };

export function resolved(directory: string, spec: string): string {
  const parts: string[] = [];
  for (const part of `${directory}/${spec}`.split("/")) {
    if (part === "..") parts.pop();
    else if (part !== "." && part !== "") parts.push(part);
  }
  return parts.join("/");
}

// Bun takes the file a specifier names, then one with an extension added, and only then the directory's index.
export function importedFile(path: string, files: ReadonlySet<string>, mains: ReadonlyMap<string, string> = new Map()): readonly string[] {
  const probe = (target: string): readonly string[] => {
    const bare = target.replace(/\.m?js$/, "");
    return [target, ...CANDIDATE_EXTENSIONS.map((extension) => bare + extension)].filter((file) => files.has(file));
  };
  const index = (target: string): readonly string[] =>
    CANDIDATE_EXTENSIONS.map((extension) => `${target}/index${extension}`).filter((file) => files.has(file));
  const direct = probe(path);
  if (direct.length > 0) return direct;
  const main = mains.get(path);
  if (main === undefined) return index(path);
  const manifest = path === "" ? "package.json" : `${path}/package.json`;
  if (main === manifest) return [manifest, ...index(path)];
  return [manifest, ...probe(main), ...index(main), ...index(path)];
}

function fixtureNeedles(changed: readonly string[]): readonly Needle[] {
  const needles = new Map<string, Needle>();
  for (const fixture of changed.filter((path) => path.startsWith(FIXTURES))) {
    const text = fixture.slice(TEST_TREE.length);
    needles.set(text, { text, kind: "file", fixture });
    for (let end = text.lastIndexOf("/"); end > 0; end = text.lastIndexOf("/", end - 1)) {
      const directory = text.slice(0, end);
      if (!needles.has(directory)) needles.set(directory, { text: directory, kind: "directory", fixture });
    }
  }
  return [...needles.values()];
}

function mentions(line: string, { text, kind }: Needle): boolean {
  if (kind === "file") return line.includes(text);
  return DIRECTORY_ENDS.some((end) => line.includes(text + end));
}

type Edge = { readonly importer: string; readonly imported: string };

export function importsOf(file: string, text: string, files: ReadonlySet<string>, mains: ReadonlyMap<string, string> = new Map()): readonly string[] {
  const directory = file.slice(0, Math.max(file.lastIndexOf("/"), 0));
  return [...text.matchAll(IMPORT)].flatMap(([, throughImport = "", throughRequire = ""]) => importedFile(resolved(directory, throughImport || throughRequire), files, mains));
}

const edgesOf = (file: string, text: string, files: ReadonlySet<string>, mains: ReadonlyMap<string, string> = new Map()): readonly Edge[] =>
  importsOf(file, text, files, mains).map((imported) => ({ importer: file, imported }));

function fixtureNamedIn(text: string, needles: readonly Needle[]): string | undefined {
  if (needles.length === 0) return undefined;
  for (const line of text.split("\n")) {
    const joined = line.replaceAll(LISTED_SEGMENTS, "/");
    const needle = needles.find((each) => mentions(joined, each));
    if (needle !== undefined) return needle.fixture;
  }
  return undefined;
}

function spread(reached: Map<string, string>, edges: readonly Edge[]): void {
  for (let grew = true; grew; ) {
    grew = false;
    for (const { importer, imported } of edges) {
      const via = reached.get(imported);
      if (via === undefined || reached.has(importer)) continue;
      reached.set(importer, via);
      grew = true;
    }
  }
}

// Maps each file that reads a changed path, through an import or the fixture's path, to that changed path.
export function readersOf(sources: ReadonlyMap<string, string>, changed: readonly string[], mains: ReadonlyMap<string, string> = new Map()): Map<string, string> {
  const reached = new Map(changed.map((path) => [path, path]));
  const needles = fixtureNeedles(changed);
  for (const [file, text] of sources) {
    const fixture = reached.has(file) ? undefined : fixtureNamedIn(text, needles);
    if (fixture !== undefined) reached.set(file, fixture);
  }
  const files = new Set([...sources.keys(), ...changed]);
  spread(reached, [...sources].flatMap(([file, text]) => edgesOf(file, text, files, mains)));
  return new Map([...reached].filter(([file, via]) => file !== via));
}
