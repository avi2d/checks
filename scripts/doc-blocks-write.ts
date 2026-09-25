#!/usr/bin/env bun
import { Console, Effect, FileSystem, Path } from "effect";
import { BUN_VERSION, DocBlocksUnwritable, kitFacts, MANIFEST, splice, TARGETS } from "./doc-blocks.ts";
import { runMain } from "./main.ts";

const write = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const root = path.join(import.meta.dir, "..");
  const read = (file: string) => fs.readFileString(path.join(root, file));
  const facts = yield* kitFacts(yield* read(MANIFEST), yield* read(BUN_VERSION));
  yield* Effect.forEach(TARGETS, ({ file, blocks }) =>
    Effect.gen(function* () {
      const spliced = splice(yield* read(file), blocks, facts);
      if (spliced.type === "unmarked") {
        return yield* new DocBlocksUnwritable({ message: `${file} lacks the markers of its generated ${spliced.blocks.join(", ")} block(s)` });
      }
      yield* fs.writeFileString(path.join(root, file), spliced.text);
    }),
  );
  yield* Console.log(`doc-blocks: wrote the generated blocks of ${TARGETS.map(({ file }) => file).join(", ")}`);
  return true;
});

if (import.meta.main) runMain("doc-blocks", write);
