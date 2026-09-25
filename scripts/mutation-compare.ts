#!/usr/bin/env bun
import { Console, Effect, FileSystem, Schema } from "effect";
import { runMain, Usage } from "./main.ts";

export type Location = {
  readonly start: { readonly line: number; readonly column: number };
  readonly end: { readonly line: number; readonly column: number };
};

export type Mutant = {
  readonly status: string;
  readonly mutatorName: string;
  readonly replacement: string;
  readonly location: Location;
};

export type MutantChange = {
  readonly path: string;
  readonly location: Location;
  readonly mutatorName: string;
  readonly replacement: string;
  readonly from: string;
  readonly to: string;
};

export type UnmatchedMutant = {
  readonly path: string;
  readonly location: Location;
  readonly mutatorName: string;
  readonly replacement: string;
  readonly status: string;
};

export type Comparison = {
  readonly regressions: readonly MutantChange[];
  readonly runtimeMoves: readonly MutantChange[];
  readonly baseOnly: readonly UnmatchedMutant[];
  readonly headOnly: readonly UnmatchedMutant[];
  readonly regression: boolean;
};

export type Options = {
  readonly basePath: string;
  readonly headPath: string;
  readonly advisory: boolean;
};

export class ReportError extends Schema.TaggedError<ReportError>()("ReportError", {
  message: Schema.String,
}) {}

const DETECTED = new Set(["Killed", "Timeout"]);
const UNDETECTED = new Set(["Survived", "NoCoverage"]);
const RUNTIME_LEAVES = new Set(["CompileError", "RuntimeError"]);
const USAGE = "usage: mutation-compare.ts [--advisory] <base-report> <head-report>";

const Report = Schema.fromJsonString(
  Schema.Struct({
    files: Schema.Record(
      Schema.String,
      Schema.Struct({
        mutants: Schema.Array(
          Schema.Struct({
            status: Schema.String,
            mutatorName: Schema.String,
            replacement: Schema.String,
            location: Schema.Struct({
              start: Schema.Struct({ line: Schema.Number, column: Schema.Number }),
              end: Schema.Struct({ line: Schema.Number, column: Schema.Number }),
            }),
          }),
        ),
      }),
    ),
  }),
);
const decodeReport = Schema.decodeUnknownEffect(Report);

export const parseReport = (source: string, text: string): Effect.Effect<Map<string, readonly Mutant[]>, ReportError> =>
  decodeReport(text).pipe(
    Effect.map(({ files }) => new Map(Object.entries(files).map(([path, { mutants }]) => [path, mutants]))),
    Effect.mapError((cause) => new ReportError({ message: `${source} is not a Stryker mutation report: ${cause.message}` })),
  );

// The key adds the position among same-signature mutants: location, mutator and replacement collide within a report.
function keyMutants(files: ReadonlyMap<string, readonly Mutant[]>): Map<string, { readonly path: string; readonly mutant: Mutant }> {
  const keyed = new Map<string, { readonly path: string; readonly mutant: Mutant }>();
  for (const [path, mutants] of files) {
    const seen = new Map<string, number>();
    for (const mutant of mutants) {
      const { location } = mutant;
      const signature = `${path}|${location.start.line}:${location.start.column}-${location.end.line}:${location.end.column}|${mutant.mutatorName}|${mutant.replacement}`;
      const occurrence = seen.get(signature) ?? 0;
      seen.set(signature, occurrence + 1);
      keyed.set(`${signature}#${occurrence}`, { path, mutant });
    }
  }
  return keyed;
}

function sortKey(mutant: { readonly path: string; readonly location: Location }): string {
  return `${mutant.path}:${mutant.location.start.line}:${mutant.location.start.column}`;
}

export function compareReports(
  baseFiles: ReadonlyMap<string, readonly Mutant[]>,
  headFiles: ReadonlyMap<string, readonly Mutant[]>,
): Comparison {
  const base = keyMutants(baseFiles);
  const head = keyMutants(headFiles);
  const regressions: MutantChange[] = [];
  const runtimeMoves: MutantChange[] = [];
  const baseOnly: UnmatchedMutant[] = [];
  const headOnly: UnmatchedMutant[] = [];

  for (const [key, { path, mutant }] of base) {
    const counterpart = head.get(key);
    if (counterpart === undefined) {
      baseOnly.push({ path, location: mutant.location, mutatorName: mutant.mutatorName, replacement: mutant.replacement, status: mutant.status });
      continue;
    }
    const change: MutantChange = {
      path,
      location: mutant.location,
      mutatorName: mutant.mutatorName,
      replacement: mutant.replacement,
      from: mutant.status,
      to: counterpart.mutant.status,
    };
    if (mutant.status !== counterpart.mutant.status && (RUNTIME_LEAVES.has(mutant.status) || RUNTIME_LEAVES.has(counterpart.mutant.status))) {
      runtimeMoves.push(change);
    } else if (DETECTED.has(mutant.status) && UNDETECTED.has(counterpart.mutant.status)) {
      regressions.push(change);
    }
  }
  for (const [key, { path, mutant }] of head) {
    if (!base.has(key)) headOnly.push({ path, location: mutant.location, mutatorName: mutant.mutatorName, replacement: mutant.replacement, status: mutant.status });
  }

  regressions.sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
  runtimeMoves.sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
  baseOnly.sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
  headOnly.sort((a, b) => sortKey(a).localeCompare(sortKey(b)));

  return { regressions, runtimeMoves, baseOnly, headOnly, regression: regressions.length > 0 };
}

function locate(mutant: { readonly path: string; readonly location: Location }): string {
  return `${mutant.path}:${mutant.location.start.line}:${mutant.location.start.column}`;
}

function describeChange(change: MutantChange): string {
  return `${locate(change)} ${change.mutatorName} ${JSON.stringify(change.replacement)}: ${change.from} -> ${change.to}`;
}

function describeUnmatched(mutant: UnmatchedMutant): string {
  return `${locate(mutant)} ${mutant.mutatorName} ${JSON.stringify(mutant.replacement)}: ${mutant.status}`;
}

export function formatComparison(comparison: Comparison, advisory: boolean): string {
  const lines: string[] = [];
  for (const change of comparison.regressions) lines.push(`  regression ${describeChange(change)}`);
  for (const change of comparison.runtimeMoves) lines.push(`  moved ${describeChange(change)}`);
  for (const mutant of comparison.baseOnly) lines.push(`  base only ${describeUnmatched(mutant)}`);
  for (const mutant of comparison.headOnly) lines.push(`  head only ${describeUnmatched(mutant)}`);
  const verdict = comparison.regression
    ? `mutation-compare: REGRESSION (${comparison.regressions.length} mutant(s))${advisory ? " in advisory mode, exit 0" : ""}`
    : `mutation-compare: no regression${advisory ? " (advisory mode, exit 0)" : ""}`;
  return [verdict, ...lines].join("\n");
}

export const parseArgs = Effect.fnUntraced(function* (argv: readonly string[]): Effect.fn.Return<Options, Usage> {
  let advisory = false;
  const paths: string[] = [];
  for (const arg of argv) {
    if (arg === "--advisory") advisory = true;
    else if (arg.startsWith("--")) return yield* new Usage({ message: `${USAGE}: unknown flag ${arg}` });
    else paths.push(arg);
  }
  const [basePath, headPath, ...extra] = paths;
  if (basePath === undefined || headPath === undefined || extra.length > 0) return yield* new Usage({ message: USAGE });
  return { basePath, headPath, advisory };
});

export function passes(comparison: Comparison, advisory: boolean): boolean {
  return advisory || !comparison.regression;
}

const load = Effect.fn("load")(function* (path: string) {
  const fs = yield* FileSystem.FileSystem;
  const text = yield* fs.readFileString(path).pipe(Effect.mapError(() => new ReportError({ message: `cannot read ${path}` })));
  return yield* parseReport(path, text);
});

const compare = Effect.gen(function* () {
  const options = yield* parseArgs(process.argv.slice(2));
  const comparison = compareReports(yield* load(options.basePath), yield* load(options.headPath));
  yield* Console.log(formatComparison(comparison, options.advisory));
  return passes(comparison, options.advisory);
});

if (import.meta.main) runMain("mutation-compare", compare);
