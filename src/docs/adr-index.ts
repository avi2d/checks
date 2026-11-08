#!/usr/bin/env bun
import { Console, Effect, FileSystem, Path } from "effect";
import { INDEX_WRITER, writtenIndex } from "./doc-index.ts";
import { ADR_DIRECTORY, ADR_INDEX, governedRecord, isRecord } from "./doc-rules.ts";
import { git, workingTreeFiles } from "../core/git.ts";
import { runMain } from "../core/main.ts";

const readOrUndefined = Effect.fn("readOrUndefined")(function* (file: string) {
  const fs = yield* FileSystem.FileSystem;
  return (yield* fs.exists(file)) ? yield* fs.readFileString(file) : undefined;
});

const write = Effect.gen(function* () {
  const { join } = yield* Path.Path;
  const { readFileString, writeFileString } = yield* FileSystem.FileSystem;
  const top = (yield* git(["rev-parse", "--show-toplevel"])).trim();
  const records = yield* Effect.forEach((yield* workingTreeFiles(top)).filter(isRecord), (record) =>
    readFileString(join(top, record)).pipe(Effect.map((text) => governedRecord({ path: record, text }))),
  );
  if (records.length === 0) {
    yield* Console.log(`${INDEX_WRITER}: ${ADR_DIRECTORY} holds no record, so there is no index to write`);
    return true;
  }
  const target = join(top, ADR_INDEX);
  yield* writeFileString(target, writtenIndex(yield* readOrUndefined(target), records));
  yield* Console.log(`${INDEX_WRITER}: wrote the index of ${records.length} record(s) into ${ADR_INDEX}`);
  return true;
});

if (import.meta.main) runMain(INDEX_WRITER, write);
