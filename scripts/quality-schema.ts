#!/usr/bin/env bun
import { Console, Effect, FileSystem, Path } from "effect";
import { runMain } from "./main.ts";
import { qualityJsonSchema, renderJson } from "./quality-file.ts";

export const SCHEMA_FILE = "quality.schema.json";

const write = Effect.gen(function* () {
  const target = (yield* Path.Path).join(import.meta.dir, "..", SCHEMA_FILE);
  yield* (yield* FileSystem.FileSystem).writeFileString(target, renderJson(qualityJsonSchema()));
  yield* Console.log(`quality-schema: wrote ${SCHEMA_FILE}`);
  return true;
});

if (import.meta.main) runMain("quality-schema", write);
