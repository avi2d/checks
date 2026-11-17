#!/usr/bin/env bun
import { Console, Effect } from "effect";
import { localTestsSetting } from "./local-tests.ts";
import { runMain, Usage } from "./main.ts";

const check = Effect.gen(function* () {
  if (process.argv.length !== 2) return yield* new Usage({ message: "usage: checks-local-tests" });
  yield* Console.log(yield* localTestsSetting(process.cwd()));
  return true;
});

if (import.meta.main) runMain("checks-local-tests", check);
