#!/usr/bin/env bun
import { Console, Effect, FileSystem, Path, Schema } from "effect";
import { git, rangeEnds, refArgs } from "../core/git.ts";
import { runMain } from "../core/main.ts";
import { scanTree } from "./knip.ts";

export type UnusedSymbol = {
  readonly file: string;
  readonly kind: "export" | "type";
  readonly name: string;
};

export type Baseline = readonly UnusedSymbol[];

export type Held = {
  readonly reported: readonly UnusedSymbol[];
  readonly base: Baseline;
  readonly head: Baseline;
};

export type Drift = {
  readonly unlisted: readonly UnusedSymbol[];
  readonly added: readonly UnusedSymbol[];
  readonly stale: readonly UnusedSymbol[];
};

const NAME = "exports";
export const BASELINE_FILE = "exports-baseline.json";
const WRITE = "--write";
const USAGE = `usage: exports.ts <ref> | <base-ref> <head-ref> | ${WRITE}`;

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

const baselinePath = Effect.fn("baselinePath")(function* (root: string) {
  return (yield* Path.Path).join(root, BASELINE_FILE);
});

const baselineInTree = Effect.fn("baselineInTree")(function* (root: string) {
  const fs = yield* FileSystem.FileSystem;
  const at = yield* baselinePath(root);
  if (!(yield* fs.exists(at))) return [] satisfies Baseline;
  return yield* fs.readFileString(at).pipe(Effect.flatMap((text) => baselineOf(text, BASELINE_FILE)));
});

const baselineAt = Effect.fn("baselineAt")(function* (treeish: string, root: string) {
  const blob = (yield* git(["ls-tree", "--object-only", treeish, "--", BASELINE_FILE], root)).trim();
  if (blob === "") return [] satisfies Baseline;
  return yield* baselineOf(yield* git(["cat-file", "blob", blob], root), `${BASELINE_FILE} at ${treeish}`);
});

const keyOf = ({ file, kind, name }: UnusedSymbol): string => `${kind}\0${file}\0${name}`;

function outside(symbols: readonly UnusedSymbol[], others: readonly UnusedSymbol[]): readonly UnusedSymbol[] {
  const known = new Set(others.map(keyOf));
  return symbols.filter((symbol) => !known.has(keyOf(symbol))).toSorted(byPosition);
}

export function driftOf({ reported, base, head }: Held): Drift {
  return { unlisted: outside(reported, head), added: outside(head, base), stale: outside(head, reported) };
}

function describe(symbol: UnusedSymbol): string {
  return `  ${symbol.file}: ${symbol.name} (${symbol.kind})`;
}

export function report(head: Baseline, { unlisted, added, stale }: Drift): string {
  const sections = [
    { symbols: unlisted, what: `unused export(s) not in ${BASELINE_FILE}:` },
    { symbols: added, what: `${BASELINE_FILE} export(s) the range adds, remove the export instead:` },
    { symbols: stale, what: `${BASELINE_FILE} export(s) no longer reported, remove them:` },
  ].filter(({ symbols }) => symbols.length > 0);
  if (sections.length > 0) {
    return sections.flatMap(({ symbols, what }) => [`${NAME}: ${symbols.length} ${what}`, ...symbols.map(describe)]).join("\n");
  }
  return head.length === 0
    ? `${NAME}: no unused exports or types`
    : `${NAME}: ${head.length} unused export(s) in ${BASELINE_FILE}, and no new ones`;
}

const scan = scanTree(NAME, ["--include", "exports,types"]).pipe(
  Effect.mapError((cause) => new ExportsError({ message: cause.message })),
);

const check = Effect.fn("check")(function* (first: string, second: string | undefined) {
  const { root, reported } = yield* scan;
  if (reported.kind === "unconfigured") return false;
  const { base } = yield* rangeEnds(first, second, root);
  const head = yield* baselineInTree(root);
  const drift = driftOf({ reported: yield* symbolsOf(reported.stdout), base: yield* baselineAt(base, root), head });
  yield* Console.log(report(head, drift));
  return drift.unlisted.length === 0 && drift.added.length === 0 && drift.stale.length === 0;
});

const seed = Effect.gen(function* () {
  const { root, reported } = yield* scan;
  if (reported.kind === "unconfigured") return false;
  const symbols = yield* symbolsOf(reported.stdout);
  yield* (yield* FileSystem.FileSystem).writeFileString(yield* baselinePath(root), `${JSON.stringify(symbols, null, 2)}\n`);
  yield* Console.log(`${NAME}: wrote ${symbols.length} unused export(s) to ${BASELINE_FILE}`);
  return true;
});

const gate = Effect.gen(function* () {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === WRITE) return yield* seed;
  const { first, second } = yield* refArgs(args, USAGE);
  return yield* check(first, second);
});

if (import.meta.main) runMain(NAME, gate);
