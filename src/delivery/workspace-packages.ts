import { Effect, FileSystem, Path, Schema } from "effect";

class WorkspaceFault extends Schema.TaggedError<WorkspaceFault>()("WorkspaceFault", {
  message: Schema.String,
}) {}

export const WorkspacePatterns = Schema.Union([Schema.Array(Schema.String), Schema.Struct({ packages: Schema.Array(Schema.String) })]);

const WorkspaceManifest = Schema.Struct({
  private: Schema.optionalKey(Schema.Boolean),
  name: Schema.optionalKey(Schema.String),
  version: Schema.optionalKey(Schema.String),
  workspaces: Schema.optionalKey(WorkspacePatterns),
});

export type WorkspaceRoot = Pick<typeof WorkspaceManifest.Type, "private" | "workspaces">;
const decodeManifest = Schema.decodeUnknownEffect(Schema.fromJsonString(WorkspaceManifest));

type Workspace = { readonly path: string; readonly name: string; readonly version: string; readonly text: string };

const workspacePaths = Effect.fn("workspacePaths")(function* (root: string, patterns: readonly string[]) {
  const selected = new Set<string>();
  for (const pattern of patterns) {
    const negative = pattern.startsWith("!");
    const relative = negative ? pattern.slice(1) : pattern;
    if (relative.startsWith("/") || relative.split("/").includes("..")) return yield* new WorkspaceFault({ message: `workspace pattern is outside the root: ${pattern}` });
    const files = yield* Effect.tryPromise({
      try: () => Array.fromAsync(new Bun.Glob(`${relative}/package.json`).scan({ cwd: root, onlyFiles: true, followSymlinks: false })),
      catch: (error) => new WorkspaceFault({ message: `workspaces: ${String(error)}` }),
    });
    for (const file of files) {
      if (file.split("/").includes("node_modules")) continue;
      if (negative) selected.delete(file);
      else selected.add(file);
    }
  }
  return [...selected].sort();
});

const readDecoded = (file: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    return yield* fs.readFileString(file);
  }).pipe(
    Effect.flatMap((text) => decodeManifest(text).pipe(Effect.map((manifest) => ({ manifest, text })))),
    Effect.mapError((error) => new WorkspaceFault({ message: `${file}: ${error.message}` })),
  );

export const publicWorkspacesOf = Effect.fn("publicWorkspacesOf")(function* (
  root: string,
  manifest: { readonly private?: boolean | undefined; readonly workspaces?: WorkspaceRoot["workspaces"] | undefined },
) {
  if (manifest.private !== true || manifest.workspaces === undefined) return [];
  const path = yield* Path.Path;
  const patterns = "packages" in manifest.workspaces ? manifest.workspaces.packages : manifest.workspaces;
  const paths = yield* workspacePaths(root, patterns);
  const packages: Workspace[] = [];
  for (const file of paths) {
    const { manifest: held, text } = yield* readDecoded(path.join(root, file));
    if (held.private === true) continue;
    if (held.name === undefined || held.version === undefined) return yield* new WorkspaceFault({ message: `${file}: a public workspace needs a name and version` });
    packages.push({ path: file, name: held.name, version: held.version, text });
  }
  return packages;
});

export const publicWorkspaces = Effect.fn("publicWorkspaces")(function* (root: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const manifestPath = path.join(root, "package.json");
  if (!(yield* fs.exists(manifestPath))) return [];
  const { manifest } = yield* readDecoded(manifestPath);
  return yield* publicWorkspacesOf(root, manifest);
});
