#!/usr/bin/env bun
import { Console, Effect, Schema } from "effect";
import { runMain } from "../core/main.ts";
import { scanTree } from "./knip.ts";

export type Scan = { readonly tracked: number; readonly files: readonly string[] };

const NAME = "unused";
const JUDGED = /[.]tsx?$|[.]astro$/;

class UnusedError extends Schema.TaggedError<UnusedError>()("UnusedError", {
  message: Schema.String,
}) {}

const decodeKnipReport = Schema.decodeUnknownEffect(
  Schema.fromJsonString(
    Schema.Struct({
      issues: Schema.Array(Schema.Struct({ files: Schema.optional(Schema.Array(Schema.Struct({ name: Schema.String }))) })),
    }),
  ),
);

export const filesOf = Effect.fn("filesOf")(function* (stdout: string) {
  const { issues } = yield* decodeKnipReport(stdout).pipe(
    Effect.mapError((cause) => new UnusedError({ message: `knip's JSON report does not decode: ${cause.message}` })),
  );
  return issues
    .flatMap(({ files = [] }) => files.map(({ name }) => name))
    .filter((file) => JUDGED.test(file))
    .toSorted();
});

export function report({ tracked, files }: Scan): string {
  if (files.length === 0) return `${NAME}: no unreferenced files among ${tracked} tracked .ts/.tsx/.astro file(s)`;
  return [`${NAME}: ${files.length} unreferenced file(s):`, ...files.map((file) => `  ${file}`)].join("\n");
}

const unused = Effect.gen(function* () {
  const { tracked, reported } = yield* scanTree(NAME, ["--files"]).pipe(
    Effect.mapError((cause) => new UnusedError({ message: cause.message })),
  );
  if (reported.kind === "unconfigured") return false;
  const files = yield* filesOf(reported.stdout);
  yield* Console.log(report({ tracked, files }));
  return files.length === 0;
});

if (import.meta.main) runMain(NAME, unused);
