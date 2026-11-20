#!/usr/bin/env bun
import { Console, Effect } from "effect";
import { allowsLocalAgentTests } from "../core/local-tests.ts";
import { runMain, Usage } from "../core/main.ts";

const check = Effect.gen(function* () {
  if (process.argv.length !== 2) return yield* new Usage({ message: "usage: checks-local-tests" });
  yield* Console.log((yield* allowsLocalAgentTests(process.cwd())) ? "allowed" : "blocked");
  return true;
});

if (import.meta.main) runMain("checks-local-tests", check);
