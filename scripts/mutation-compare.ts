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
  readonly killedBy?: readonly string[];
  readonly location: Location;
};

export type ReportFile = {
  readonly source: string;
  readonly mutants: readonly Mutant[];
};

export type TestFile = {
  readonly tests: readonly { readonly id: string; readonly name: string }[];
};

export type KillRun = {
  readonly files: ReadonlyMap<string, ReportFile>;
  readonly testFiles: ReadonlyMap<string, TestFile>;
  readonly bail: "off" | "on" | "unrecorded";
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
  readonly moves: readonly MutantChange[];
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
const LEAVES_SCORE = new Set(["CompileError", "RuntimeError", "Ignored", "Pending"]);
const USAGE = "usage: mutation-compare.ts [--advisory] <base-report> <head-report>";

const Files = Schema.Record(
  Schema.String,
  Schema.Struct({
    source: Schema.String,
    mutants: Schema.Array(
      Schema.Struct({
        status: Schema.String,
        mutatorName: Schema.String,
        replacement: Schema.String,
        killedBy: Schema.optionalKey(Schema.Array(Schema.String)),
        location: Schema.Struct({
          start: Schema.Struct({ line: Schema.Finite, column: Schema.Finite }),
          end: Schema.Struct({ line: Schema.Finite, column: Schema.Finite }),
        }),
      }),
    ),
  }),
);
const decodeReport = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Struct({ files: Files })));
const decodeKillRun = Schema.decodeUnknownEffect(
  Schema.fromJsonString(
    Schema.Struct({
      files: Files,
      testFiles: Schema.Record(Schema.String, Schema.Struct({ tests: Schema.Array(Schema.Struct({ id: Schema.String, name: Schema.String })) })),
      config: Schema.optionalKey(Schema.Struct({ disableBail: Schema.optionalKey(Schema.Boolean) })),
    }),
  ),
);

const notAReport = (source: string) => (cause: { readonly message: string }) => new ReportError({ message: `${source} is not a Stryker mutation report: ${cause.message}` });

export const parseReport = (source: string, text: string): Effect.Effect<Map<string, ReportFile>, ReportError> =>
  decodeReport(text).pipe(
    Effect.map(({ files }) => new Map(Object.entries(files))),
    Effect.mapError(notAReport(source)),
  );

function bailOf(config: { readonly disableBail?: boolean } | undefined): KillRun["bail"] {
  if (config === undefined) return "unrecorded";
  return config.disableBail === true ? "off" : "on";
}

export const parseKillRun = (source: string, text: string): Effect.Effect<KillRun, ReportError> =>
  decodeKillRun(text).pipe(
    Effect.map(({ files, testFiles, config }) => ({
      files: new Map(Object.entries(files)),
      testFiles: new Map(Object.entries(testFiles)),
      bail: bailOf(config),
    })),
    Effect.mapError(notAReport(source)),
  );

function byPosition(a: { readonly path: string; readonly location: Location }, b: { readonly path: string; readonly location: Location }): number {
  if (a.path !== b.path) return a.path < b.path ? -1 : 1;
  return a.location.start.line - b.location.start.line || a.location.start.column - b.location.start.column;
}

function sharedEnds(base: readonly string[], head: readonly string[]): { readonly prefix: number; readonly suffix: number } {
  let prefix = 0;
  while (prefix < base.length && prefix < head.length && base[prefix] === head[prefix]) prefix++;
  let suffix = 0;
  while (suffix < base.length - prefix && suffix < head.length - prefix && base[base.length - 1 - suffix] === head[head.length - 1 - suffix]) suffix++;
  return { prefix, suffix };
}

function commonAfterTable(base: readonly string[], head: readonly string[], prefix: number, rows: number, width: number): (row: number, column: number) => number {
  const common = new Uint32Array((rows + 1) * width);
  const commonAfter = (row: number, column: number) => common[row * width + column] ?? 0;
  for (let row = rows - 1; row >= 0; row--) {
    for (let column = width - 2; column >= 0; column--) {
      common[row * width + column] =
        base[prefix + row] === head[prefix + column] ? commonAfter(row + 1, column + 1) + 1 : Math.max(commonAfter(row + 1, column), commonAfter(row, column + 1));
    }
  }
  return commonAfter;
}

function unchangedLines(baseSource: string, headSource: string): Map<number, number> {
  const base = baseSource.split("\n");
  const head = headSource.split("\n");
  const { prefix, suffix } = sharedEnds(base, head);
  const rows = base.length - prefix - suffix;
  const width = head.length - prefix - suffix + 1;
  const commonAfter = commonAfterTable(base, head, prefix, rows, width);
  const lines = new Map<number, number>();
  for (let line = 1; line <= prefix; line++) lines.set(line, line);
  for (let row = 0, column = 0; row < rows && column < width - 1; ) {
    if (base[prefix + row] === head[prefix + column]) lines.set(prefix + ++row, prefix + ++column);
    else if (commonAfter(row + 1, column) >= commonAfter(row, column + 1)) row++;
    else column++;
  }
  for (let line = 1; line <= suffix; line++) lines.set(base.length - suffix + line, head.length - suffix + line);
  return lines;
}

function mapLocation(location: Location, lines: ReadonlyMap<number, number>): Location | undefined {
  for (let line = location.start.line; line <= location.end.line; line++) if (!lines.has(line)) return undefined;
  const start = lines.get(location.start.line);
  const end = lines.get(location.end.line);
  if (start === undefined || end === undefined || end - start !== location.end.line - location.start.line) return undefined;
  return { start: { line: start, column: location.start.column }, end: { line: end, column: location.end.column } };
}

function keyMutants(
  path: string,
  mutants: readonly Mutant[],
  place: (location: Location) => Location | undefined,
): { readonly keyed: Map<string, UnmatchedMutant>; readonly unplaced: readonly UnmatchedMutant[] } {
  const keyed = new Map<string, UnmatchedMutant>();
  const unplaced: UnmatchedMutant[] = [];
  const seen = new Map<string, number>();
  for (const mutant of mutants) {
    const location = place(mutant.location);
    if (location === undefined) {
      unplaced.push({ path, ...mutant });
      continue;
    }
    const signature = JSON.stringify([location.start, location.end, mutant.mutatorName, mutant.replacement]);
    const occurrence = seen.get(signature) ?? 0;
    seen.set(signature, occurrence + 1);
    keyed.set(`${signature}#${occurrence}`, { path, ...mutant });
  }
  return { keyed, unplaced };
}

type Findings = {
  readonly regressions: MutantChange[];
  readonly moves: MutantChange[];
  readonly baseOnly: UnmatchedMutant[];
  readonly headOnly: UnmatchedMutant[];
};

function judgeMatch(path: string, mutant: UnmatchedMutant, counterpart: UnmatchedMutant, findings: Findings): void {
  const change: MutantChange = {
    path,
    location: counterpart.location,
    mutatorName: mutant.mutatorName,
    replacement: mutant.replacement,
    from: mutant.status,
    to: counterpart.status,
  };
  if (mutant.status !== counterpart.status && (LEAVES_SCORE.has(mutant.status) || LEAVES_SCORE.has(counterpart.status))) {
    findings.moves.push(change);
  } else if (DETECTED.has(mutant.status) && UNDETECTED.has(counterpart.status)) {
    findings.regressions.push(change);
  }
}

function compareFile(path: string, baseFile: ReportFile | undefined, headFile: ReportFile | undefined, findings: Findings): void {
  const lines = baseFile !== undefined && headFile !== undefined ? unchangedLines(baseFile.source, headFile.source) : new Map<number, number>();
  const base = keyMutants(path, baseFile?.mutants ?? [], (location) => mapLocation(location, lines));
  const head = keyMutants(path, headFile?.mutants ?? [], (location) => location);
  findings.baseOnly.push(...base.unplaced);
  for (const [key, mutant] of base.keyed) {
    const counterpart = head.keyed.get(key);
    if (counterpart === undefined) findings.baseOnly.push(mutant);
    else judgeMatch(path, mutant, counterpart, findings);
  }
  for (const [key, mutant] of head.keyed) {
    if (!base.keyed.has(key)) findings.headOnly.push(mutant);
  }
}

export function compareReports(baseFiles: ReadonlyMap<string, ReportFile>, headFiles: ReadonlyMap<string, ReportFile>): Comparison {
  const findings: Findings = { regressions: [], moves: [], baseOnly: [], headOnly: [] };
  for (const path of new Set([...baseFiles.keys(), ...headFiles.keys()])) compareFile(path, baseFiles.get(path), headFiles.get(path), findings);

  findings.regressions.sort(byPosition);
  findings.moves.sort(byPosition);
  findings.baseOnly.sort(byPosition);
  findings.headOnly.sort(byPosition);

  return { ...findings, regression: findings.regressions.length > 0 };
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
  for (const change of comparison.moves) lines.push(`  moved ${describeChange(change)}`);
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
