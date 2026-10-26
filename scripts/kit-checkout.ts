import { Effect, FileSystem, Path } from "effect";

export const kitCheckout = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const root = path.join(import.meta.dir, "..");
  return {
    read: (file: string) => fs.readFileString(path.join(root, file)),
    write: (file: string, text: string) => fs.writeFileString(path.join(root, file), text),
    makeDirectory: (directory: string) => fs.makeDirectory(path.join(root, directory), { recursive: true }),
  };
});
