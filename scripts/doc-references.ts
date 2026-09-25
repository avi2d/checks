import { scanMarkdown, type MarkdownLine } from "./prose-matchers.ts";

export type ReferenceKind = "path" | "link" | "command";

export type Unresolved = {
  readonly kind: ReferenceKind;
  readonly line: number;
  readonly named: string;
  readonly message: string;
  readonly missing:
    | { readonly type: "file"; readonly path: string }
    | { readonly type: "script"; readonly name: string; readonly packageDirectory: string }
    | { readonly type: "anchor" };
};

export type Snapshot = {
  readonly files: ReadonlySet<string>;
  readonly directories: ReadonlySet<string>;
  readonly roots: ReadonlySet<string>;
  readonly anchors: ReadonlyMap<string, ReadonlySet<string>>;
  readonly scripts: ReadonlyMap<string, ReadonlySet<string>>;
};

export const PACKAGE_MANIFEST = "package.json";

export function rootsOf(files: readonly string[]): readonly string[] {
  return files.flatMap((file) => (file.includes("/") ? [file.slice(0, file.indexOf("/"))] : []));
}

export function snapshotOf(
  files: readonly string[],
  anchors: ReadonlyMap<string, ReadonlySet<string>>,
  scripts: ReadonlyMap<string, ReadonlySet<string>>,
  alsoRoots: readonly string[] = [],
): Snapshot {
  const directories = new Set<string>([""]);
  for (const file of files) for (let at = file.indexOf("/"); at >= 0; at = file.indexOf("/", at + 1)) directories.add(file.slice(0, at));
  return { files: new Set(files), directories, roots: new Set([...rootsOf(files), ...alsoRoots]), anchors, scripts };
}

function directoryOf(path: string): string {
  return path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
}

function normalize(path: string): string | undefined {
  const parts: string[] = [];
  for (const part of path.split("/")) {
    if (part === "" || part === ".") continue;
    if (part !== "..") parts.push(part);
    else if (parts.pop() === undefined) return undefined;
  }
  return parts.join("/");
}

function within(directory: string, path: string): string | undefined {
  return normalize(directory === "" ? path : `${directory}/${path}`);
}

function exists(snapshot: Snapshot, path: string): boolean {
  return snapshot.files.has(path) || snapshot.directories.has(path);
}

const RELATIVE = /^\.{1,2}\//;
const PATH = /^((?:\.{1,2}\/)*(?:[\w.@-]+\/)+[\w.@-]+\.(?:ts|tsx|mts|cts|js|jsx|cjs|mjs|md|mdx|json|jsonc|sh|bash|zsh|toml|nix|lua|ya?ml|txt|py|rs|go|css|html))(?::\d+(?::\d+)?)?$/;

function unresolvedPath(doc: string, line: number, span: string, snapshot: Snapshot): Unresolved | undefined {
  const named = PATH.exec(span)?.[1];
  if (named === undefined) return undefined;
  const fromDoc = within(directoryOf(doc), named);
  const fromRoot = RELATIVE.test(named) ? undefined : normalize(named);
  if ([fromRoot, fromDoc].some((path) => path !== undefined && exists(snapshot, path))) return undefined;
  const checked = fromRoot ?? fromDoc;
  // A path whose top directory this repository lacks names a file in another one, such as a consumer's.
  if (checked === undefined || (fromRoot !== undefined && !snapshot.roots.has(fromRoot.split("/")[0] ?? ""))) return undefined;
  return { kind: "path", line, named, message: `names \`${named}\`, which is not in the repository`, missing: { type: "file", path: checked } };
}

const SCHEME = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;
const ASCII_ESCAPE = /%([0-7][0-9a-f])/gi;

function unresolvedLink(doc: string, line: number, target: string, snapshot: Snapshot): Unresolved | undefined {
  if (target === "" || SCHEME.test(target)) return undefined;
  const hash = target.indexOf("#");
  const written = (hash < 0 ? target : target.slice(0, hash)).split("?", 1)[0] ?? "";
  const decoded = written.replace(ASCII_ESCAPE, (_, code: string) => String.fromCharCode(Number.parseInt(code, 16)));
  const path = decoded === "" ? doc : decoded.startsWith("/") ? normalize(decoded) : within(directoryOf(doc), decoded);
  if (path === undefined) return undefined;
  const named = target;
  if (!exists(snapshot, path)) {
    return { kind: "link", line, named, message: `links to \`${named}\`, which is not in the repository`, missing: { type: "file", path } };
  }
  const anchor = hash < 0 ? "" : target.slice(hash + 1);
  const anchors = snapshot.anchors.get(path);
  if (anchor === "" || anchors === undefined || anchors.has(anchor) || anchors.has(anchor.toLowerCase())) return undefined;
  return { kind: "link", line, named, message: `links to \`${named}\`, and \`${path}\` has no heading with that anchor`, missing: { type: "anchor" } };
}

const RUN = /\bbun run\s+([^\s`'"]+)/g;
const RUNS_A_FILE = /\/|\.[cm]?[jt]sx?$/;
const NOT_A_NAME = /^[-$<{]/;

function packageOf(doc: string, snapshot: Snapshot): string | undefined {
  for (let directory: string | undefined = directoryOf(doc); directory !== undefined; directory = directory === "" ? undefined : directoryOf(directory)) {
    if (snapshot.files.has(directory === "" ? PACKAGE_MANIFEST : `${directory}/${PACKAGE_MANIFEST}`)) return directory;
  }
  return undefined;
}

function unresolvedCommand(doc: string, line: number, name: string, snapshot: Snapshot): Unresolved | undefined {
  const packageDirectory = packageOf(doc, snapshot);
  if (packageDirectory === undefined || NOT_A_NAME.test(name)) return undefined;
  const named = `bun run ${name}`;
  if (RUNS_A_FILE.test(name)) {
    const path = within(packageDirectory, name);
    if (path === undefined || exists(snapshot, path)) return undefined;
    return { kind: "command", line, named, message: `runs \`${named}\`, and \`${path}\` is not in the repository`, missing: { type: "file", path } };
  }
  if (snapshot.scripts.get(packageDirectory)?.has(name) === true) return undefined;
  const manifest = packageDirectory === "" ? PACKAGE_MANIFEST : `${packageDirectory}/${PACKAGE_MANIFEST}`;
  return {
    kind: "command",
    line,
    named,
    message: `runs \`${named}\`, and \`${name}\` is not a script in \`${manifest}\``,
    missing: { type: "script", name, packageDirectory },
  };
}

function commandsOn({ kind, raw, code }: MarkdownLine): readonly string[] {
  const texts = kind === "code" ? [raw] : code;
  return texts.flatMap((text) => [...text.matchAll(RUN)].map(([, name = ""]) => name.replace(/[),.;:]+$/, "")));
}

export type Judging = { readonly commands: boolean };

export function unresolvedIn(doc: string, text: string, snapshot: Snapshot, { commands }: Judging): readonly Unresolved[] {
  return scanMarkdown(text).flatMap((markdown) => {
    const { line } = markdown;
    const prose = markdown.kind === "code" || markdown.kind === "front-matter" ? [] : markdown.code.map((span) => unresolvedPath(doc, line, span, snapshot));
    const links = markdown.links.map((target) => unresolvedLink(doc, line, target, snapshot));
    const runs = commands && markdown.kind !== "front-matter" ? commandsOn(markdown).map((name) => unresolvedCommand(doc, line, name, snapshot)) : [];
    return [...prose, ...links, ...runs].filter((found) => found !== undefined);
  });
}

export function anchoredTargets(doc: string, text: string): readonly string[] {
  return scanMarkdown(text).flatMap(({ links }) =>
    links.flatMap((target) => {
      const hash = target.indexOf("#");
      if (hash < 0 || SCHEME.test(target)) return [];
      const written = target.slice(0, hash);
      const path = written === "" ? doc : written.startsWith("/") ? normalize(written) : within(directoryOf(doc), written);
      return path?.endsWith(".md") === true ? [path] : [];
    }),
  );
}

export function packagesOf(docs: readonly string[], snapshot: Snapshot): readonly string[] {
  return [...new Set(docs.flatMap((doc) => packageOf(doc, snapshot) ?? []))];
}

const EXPLICIT_ANCHOR = /<a\s[^>]*\b(?:id|name)="([^"]+)"/g;
const HEADING_MARKERS = /^\s{0,3}#{1,6}\s*|\s+#+\s*$/g;

function headingText(raw: string): string {
  return raw
    .replace(HEADING_MARKERS, "")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/[`*]/g, "")
    .trim();
}

export function anchorsOf(text: string): ReadonlySet<string> {
  const anchors = new Set<string>();
  const seen = new Map<string, number>();
  for (const { kind, raw } of scanMarkdown(text)) {
    if (kind === "code" || kind === "front-matter") continue;
    for (const [, id = ""] of raw.matchAll(EXPLICIT_ANCHOR)) anchors.add(id);
    if (kind !== "heading") continue;
    const slug = headingText(raw)
      .toLowerCase()
      .replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, "")
      .replaceAll(" ", "-");
    const count = seen.get(slug) ?? 0;
    anchors.add(count === 0 ? slug : `${slug}-${count}`);
    seen.set(slug, count + 1);
  }
  return anchors;
}
