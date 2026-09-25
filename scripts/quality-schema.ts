#!/usr/bin/env bun
import { Console, Effect } from "effect";
import { kitCheckout } from "./kit-checkout.ts";
import { runMain } from "./main.ts";
import { qualityJsonSchema, renderJson } from "./quality-file.ts";

export const SCHEMA_FILE = "quality.schema.json";

const write = Effect.gen(function* () {
  yield* (yield* kitCheckout).write(SCHEMA_FILE, renderJson(qualityJsonSchema()));
  yield* Console.log(`quality-schema: wrote ${SCHEMA_FILE}`);
  return true;
});

if (import.meta.main) runMain("quality-schema", write);
