#!/usr/bin/env bun
import { Console, Effect, FileSystem, Path, Schema } from "effect";
import { runMain } from "../core/main.ts";
import { scanTree } from "./knip.ts";

export type UnusedSymbol = {
  readonly file: string;
  readonly kind: "export" | "type";
  readonly name: string;
};

export type Baseline = readonly UnusedSymbol[];

export type Drift = {
  readonly unlisted: readonly UnusedSymbol[];
  readonly stale: readonly UnusedSymbol[];
};

const NAME = "exports";
export const BASELINE_FILE = "exports-baseline.json";

class ExportsError extends Schema.TaggedError<ExportsError>()("ExportsError", {
  message: Schema.String,
}) {}

const KnipSymbol = Schema.Struct({ name: Schema.String });

const decodeKnipReport = Schema.decodeUnknownEffect(
  Schema.fromJsonString(
    Schema.Struct({
      issues: Schema.Array(
        Schema.Struct({
          file: Schema.String,
          exports: Schema.optional(Schema.Array(KnipSymbol)),
          types: Schema.optional(Schema.Array(KnipSymbol)),
        }),
      ),
    }),
  ),
);

const decodeBaseline = Schema.decodeUnknownEffect(
  Schema.fromJsonString(
    Schema.Array(
      Schema.Struct({
        file: Schema.String,
        kind: Schema.Literals(["export", "type"]),
        name: Schema.String,
      }),
    ),
  ),
);

function byPosition(a: UnusedSymbol, b: UnusedSymbol): number {
  return a.file.localeCompare(b.file) || a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name);
}

export const symbolsOf = Effect.fn("symbolsOf")(function* (stdout: string) {
  const { issues } = yield* decodeKnipReport(stdout).pipe(
    Effect.mapError((cause) => new ExportsError({ message: `knip's JSON report does not decode: ${cause.message}` })),
  );
  return issues
    .flatMap(({ file, exports = [], types = [] }): readonly UnusedSymbol[] => [
      ...exports.map(({ name }): UnusedSymbol => ({ file, kind: "export", name })),
      ...types.map(({ name }): UnusedSymbol => ({ file, kind: "type", name })),
    ])
    .toSorted(byPosition);
});

export const baselineOf = Effect.fn("baselineOf")(function* (text: string, where: string) {
  return yield* decodeBaseline(text).pipe(
    Effect.mapError((cause) => new ExportsError({ message: `${where} does not decode: ${cause.message}` })),
  );
});

const readBaseline = Effect.fn("readBaseline")(function* (root: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const at = path.join(root, BASELINE_FILE);
  if (!(yield* fs.exists(at))) return [] satisfies Baseline;
  return yield* fs.readFileString(at).pipe(Effect.flatMap((text) => baselineOf(text, BASELINE_FILE)));
});

const keyOf = ({ file, kind, name }: UnusedSymbol): string => `${kind}\0${file}\0${name}`;

export function driftOf(reported: readonly UnusedSymbol[], baseline: readonly UnusedSymbol[]): Drift {
  const seen = new Set(reported.map(keyOf));
  const known = new Set(baseline.map(keyOf));
  return {
    unlisted: reported.filter((symbol) => !known.has(keyOf(symbol))).toSorted(byPosition),
    stale: baseline.filter((symbol) => !seen.has(keyOf(symbol))).toSorted(byPosition),
  };
}

function describe(symbol: UnusedSymbol): string {
  return `  ${symbol.file}: ${symbol.name} (${symbol.kind})`;
}

export function report(baseline: readonly UnusedSymbol[], { unlisted, stale }: Drift): string {
  const held =
    baseline.length === 0
      ? [`${NAME}: no unused exports or types`]
      : [`${NAME}: ${baseline.length} unused export(s) in ${BASELINE_FILE}, and no new ones`];
  if (unlisted.length === 0 && stale.length === 0) return held.join("\n");
  return [
    ...(unlisted.length === 0
      ? []
      : [`${NAME}: ${unlisted.length} unused export(s) not in ${BASELINE_FILE}:`, ...unlisted.map(describe)]),
    ...(stale.length === 0
      ? []
      : [`${NAME}: ${stale.length} ${BASELINE_FILE} export(s) no longer reported, remove them:`, ...stale.map(describe)]),
  ].join("\n");
}

const check = Effect.gen(function* () {
  const { root, reported } = yield* scanTree(NAME, ["--include", "exports,types"]).pipe(
    Effect.mapError((cause) => new ExportsError({ message: cause.message })),
  );
  if (reported.kind === "unconfigured") return false;
  const baseline = yield* readBaseline(root);
  const drift = driftOf(yield* symbolsOf(reported.stdout), baseline);
  yield* Console.log(report(baseline, drift));
  return drift.unlisted.length === 0 && drift.stale.length === 0;
});

if (import.meta.main) runMain(NAME, check);
