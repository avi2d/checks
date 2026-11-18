import { Data, Effect, FileSystem, Path } from "effect";

class FolderMissing extends Data.TaggedError("FolderMissing")<{ readonly message: string }> {}

// The files come back relative to the root, with / between their parts on every platform.
export const builtFiles = Effect.fn("builtFiles")(function* (input: string, folder: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const root = path.resolve(folder);
  const isDirectory = yield* fs.stat(root).pipe(
    Effect.map(({ type }) => type === "Directory"),
    Effect.orElseSucceed(() => false),
  );
  if (!isDirectory) return yield* new FolderMissing({ message: `${input} names ${folder}, which is not a folder, so build the site first` });
  const files: string[] = [];
  for (const entry of yield* fs.readDirectory(root, { recursive: true })) {
    if ((yield* fs.stat(path.join(root, entry))).type === "File") files.push(entry.split(path.sep).join("/"));
  }
  return { root, files };
});
