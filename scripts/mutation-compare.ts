#!/usr/bin/env bun
import { Console, Effect, FileSystem, Schema } from "effect";
import { runMain, Usage } from "./main.ts";

export type Tally = {
  readonly killed: number;
  readonly total: number;
};

export type FileComparison = {
  readonly path: string;
  readonly base: Tally;
  readonly head: Tally;
};

export type Comparison = {
  readonly base: Tally;
  readonly head: Tally;
  readonly files: readonly FileComparison[];
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
const USAGE = "usage: mutation-compare.ts [--advisory] <base-report> <head-report>";

const Report = Schema.fromJsonString(
  Schema.Struct({
    files: Schema.Record(
      Schema.String,
      Schema.Struct({ mutants: Schema.Array(Schema.Struct({ status: Schema.String })) }),
    ),
  }),
);
const decodeReport = Schema.decodeUnknownEffect(Report);

export const parseReport = (source: string, text: string): Effect.Effect<Map<string, readonly string[]>, ReportError> =>
  decodeReport(text).pipe(
    Effect.map(
      ({ files }) => new Map(Object.entries(files).map(([path, { mutants }]) => [path, mutants.map(({ status }) => status)])),
    ),
    Effect.mapError((cause) => new ReportError({ message: `${source} is not a Stryker mutation report: ${cause.message}` })),
  );

function tally(statuses: readonly string[]): Tally {
  let killed = 0;
  let total = 0;
  for (const status of statuses) {
    if (DETECTED.has(status)) killed += 1;
    if (DETECTED.has(status) || UNDETECTED.has(status)) total += 1;
  }
  return { killed, total };
}

const EMPTY: Tally = { killed: 0, total: 0 };

export function compareReports(
  baseFiles: ReadonlyMap<string, readonly string[]>,
  headFiles: ReadonlyMap<string, readonly string[]>,
): Comparison {
  const paths = [...new Set([...baseFiles.keys(), ...headFiles.keys()])].sort();
  const files = paths.map((path) => {
    const baseStatuses = baseFiles.get(path);
    const headStatuses = headFiles.get(path);
    return {
      path,
      base: baseStatuses === undefined ? EMPTY : tally(baseStatuses),
      head: headStatuses === undefined ? EMPTY : tally(headStatuses),
    };
  });
  const base = tally([...baseFiles.values()].flat());
  const head = tally([...headFiles.values()].flat());
  return { base, head, files, regression: regressed(base, head) };
}

export function regressed(base: Tally, head: Tally): boolean {
  if (base.total === 0) return head.total > 0 && head.killed < head.total;
  if (head.total === 0) return false;
  return head.killed * base.total < base.killed * head.total;
}

function points(count: Tally): number {
  return count.total === 0 ? 100 : (100 * count.killed) / count.total;
}

function percent(count: Tally): string {
  return count.total === 0 ? "n/a" : `${points(count).toFixed(2)}%`;
}

function describe(count: Tally): string {
  return `${percent(count)} (${count.killed}/${count.total})`;
}

function deltaPoints(base: Tally, head: Tally): string {
  const delta = points(head) - points(base);
  return `${delta < 0 ? "-" : "+"}${Math.abs(delta).toFixed(2)}pp`;
}

export function formatComparison(comparison: Comparison, advisory: boolean): string {
  const changed = comparison.files.filter(
    (file) => file.base.killed !== file.head.killed || file.base.total !== file.head.total,
  );
  const unchanged = comparison.files.length - changed.length;
  const lines = [
    `mutation-compare: base ${describe(comparison.base)} head ${describe(comparison.head)} delta ${deltaPoints(comparison.base, comparison.head)}`,
  ];
  for (const file of changed) {
    lines.push(`  ${file.path}: ${describe(file.base)} -> ${describe(file.head)}`);
  }
  if (unchanged > 0) lines.push(`  ${unchanged} unchanged file(s)`);
  if (comparison.regression) {
    lines.push(`mutation-compare: REGRESSION (${deltaPoints(comparison.base, comparison.head)})${advisory ? " in advisory mode, exit 0" : ""}`);
  } else {
    lines.push(`mutation-compare: no regression${advisory ? " (advisory mode, exit 0)" : ""}`);
  }
  return lines.join("\n");
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
