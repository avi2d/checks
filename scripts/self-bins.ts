#!/usr/bin/env bun
import { Console, Data, Effect, FileSystem, Path, Schema } from "effect";
import { runMain } from "../src/core/main.ts";

const BIN_NAME = /^[A-Za-z0-9._-]+$/;

const decodeManifest = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Struct({ bin: Schema.Record(Schema.String, Schema.String) })));

class BinNameError extends Data.TaggedError("BinNameError")<{ readonly message: string }> {}

const quoted = (text: string): string => `'${text.replaceAll("'", "'\\''")}'`;

// The kit installs no copy of itself, so bunx finds a kit command here only through the wrapper this writes.
const selfBins = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const root = process.cwd();
  const { bin } = yield* decodeManifest(yield* fs.readFileString(path.join(root, "package.json")));
  const directory = path.join(root, "node_modules", ".bin");
  yield* fs.makeDirectory(directory, { recursive: true });
  for (const [name, source] of Object.entries(bin)) {
    if (!BIN_NAME.test(name)) return yield* new BinNameError({ message: `package.json names bin ${JSON.stringify(name)}, which is no file name in node_modules/.bin` });
    const runner = source.endsWith(".sh") ? "sh" : "bun";
    const wrapper = path.join(directory, name);
    yield* fs.remove(wrapper, { force: true });
    yield* fs.writeFileString(wrapper, `#!/bin/sh\nexec ${runner} ${quoted(path.join(root, source))} "$@"\n`, { mode: 0o755 });
  }
  yield* Console.log(`self-bins: wrote ${Object.keys(bin).length} wrapper(s) in node_modules/.bin`);
  return true;
});

if (import.meta.main) runMain("self-bins", selfBins);
