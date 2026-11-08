#!/usr/bin/env bun
import { Console, Effect, FileSystem, Path, Schema } from "effect";
import { runMain, Usage } from "../core/main.ts";

const NAME = "mutation-merge";
const USAGE = "usage: mutation-merge.ts <output> <shard-report>...";

const Rest = [Schema.Record(Schema.String, Schema.Unknown)] as const;

const TestSchema = Schema.StructWithRest(Schema.Struct({ id: Schema.String, name: Schema.String, location: Schema.optionalKey(Schema.Unknown) }), Rest);
const TestFileSchema = Schema.StructWithRest(Schema.Struct({ source: Schema.optionalKey(Schema.String), tests: Schema.Array(TestSchema) }), Rest);
const MutantSchema = Schema.StructWithRest(
  Schema.Struct({ id: Schema.String, coveredBy: Schema.optionalKey(Schema.Array(Schema.String)), killedBy: Schema.optionalKey(Schema.Array(Schema.String)) }),
  Rest,
);
const FileSchema = Schema.StructWithRest(Schema.Struct({ source: Schema.String, mutants: Schema.Array(MutantSchema) }), Rest);
const ReportSchema = Schema.StructWithRest(
  Schema.Struct({
    schemaVersion: Schema.String,
    files: Schema.Record(Schema.String, FileSchema),
    testFiles: Schema.optionalKey(Schema.Record(Schema.String, TestFileSchema)),
  }),
  Rest,
);

export type Report = typeof ReportSchema.Type;
type TestFile = typeof TestFileSchema.Type;
type Mutant = typeof MutantSchema.Type;

const decodeReport = Schema.decodeUnknownEffect(Schema.fromJsonString(ReportSchema));

export class MergeError extends Schema.TaggedError<MergeError>()("MergeError", {
  message: Schema.String,
}) {}

export type Shard = { readonly path: string; readonly report: Report };

export type Merged = { readonly merged: Report } | { readonly conflict: string };

// Each run numbers its tests from zero, so a test is the same across shards by its file, name and location.
const testKey = (file: string, test: TestFile["tests"][number]): string => JSON.stringify([file, test.name, test.location ?? null]);

type Ids = { readonly next: () => string };

const counter = (): Ids => {
  let issued = 0;
  return { next: () => `${issued++}` };
};

function mergeTestFiles(shards: readonly Shard[]): { readonly testFiles: Record<string, TestFile>; readonly renamed: readonly ReadonlyMap<string, string>[] } | { readonly conflict: string } {
  const testFiles: Record<string, TestFile> = {};
  const merged = new Map<string, string>();
  const ids = counter();
  const renamed: Map<string, string>[] = [];
  for (const { path, report } of shards) {
    const ownIds = new Map<string, string>();
    for (const [file, testFile] of Object.entries(report.testFiles ?? {})) {
      const held = testFiles[file] ?? { ...testFile, tests: [] };
      if (held.source !== testFile.source) return { conflict: `${path} ran another source of ${file} than the shard before it, so the shards did not run one commit` };
      const tests = [...held.tests];
      for (const test of testFile.tests) {
        const key = testKey(file, test);
        const id = merged.get(key) ?? ids.next();
        if (!merged.has(key)) tests.push({ ...test, id });
        merged.set(key, id);
        ownIds.set(test.id, id);
      }
      testFiles[file] = { ...held, tests };
    }
    renamed.push(ownIds);
  }
  return { testFiles, renamed };
}

function renamedMutant(mutant: Mutant, id: string, ownIds: ReadonlyMap<string, string>): Mutant | undefined {
  const rename = (tests: readonly string[] | undefined) => tests?.map((test) => ownIds.get(test));
  const coveredBy = rename(mutant.coveredBy);
  const killedBy = rename(mutant.killedBy);
  if (coveredBy?.includes(undefined) === true || killedBy?.includes(undefined) === true) return undefined;
  return {
    ...mutant,
    id,
    ...(coveredBy === undefined ? {} : { coveredBy: coveredBy.flatMap((test) => test ?? []) }),
    ...(killedBy === undefined ? {} : { killedBy: killedBy.flatMap((test) => test ?? []) }),
  };
}

function mergeFiles(shards: readonly Shard[], renamed: readonly ReadonlyMap<string, string>[]): { readonly files: Report["files"] } | { readonly conflict: string } {
  const files: Record<string, Report["files"][string]> = {};
  const owners = new Map<string, string>();
  const ids = counter();
  for (const [index, { path, report }] of shards.entries()) {
    const ownIds = renamed[index] ?? new Map<string, string>();
    for (const [file, reported] of Object.entries(report.files)) {
      const owner = owners.get(file);
      if (owner !== undefined) return { conflict: `${file} is in both ${owner} and ${path}, so the shards did not split the mutated files` };
      owners.set(file, path);
      const mutants: Mutant[] = [];
      for (const mutant of reported.mutants) {
        const kept = renamedMutant(mutant, ids.next(), ownIds);
        if (kept === undefined) return { conflict: `mutant ${mutant.id} in ${file} of ${path} names a test the report's testFiles do not hold` };
        mutants.push(kept);
      }
      files[file] = { ...reported, mutants };
    }
  }
  return { files };
}

// Shards mutate disjoint files and test one commit, so the merge keeps every file and every test once.
export function mergeShards(shards: readonly [Shard, ...Shard[]]): Merged {
  const [first] = shards;
  const versions = shards.find(({ report }) => report.schemaVersion !== first.report.schemaVersion);
  if (versions !== undefined) return { conflict: `${versions.path} has schema version ${versions.report.schemaVersion}, and ${first.path} has ${first.report.schemaVersion}` };
  const tests = mergeTestFiles(shards);
  if ("conflict" in tests) return tests;
  const merged = mergeFiles(shards, tests.renamed);
  if ("conflict" in merged) return merged;
  const testFiles = shards.some(({ report }) => report.testFiles !== undefined) ? { testFiles: tests.testFiles } : {};
  return { merged: { ...first.report, files: merged.files, ...testFiles } };
}

export type Options = { readonly output: string; readonly inputs: readonly [string, ...string[]] };

export const parseArgs = Effect.fnUntraced(function* (argv: readonly string[]): Effect.fn.Return<Options, Usage> {
  const [output, first, ...rest] = argv;
  if (output === undefined || first === undefined || argv.some((arg) => arg.startsWith("-"))) return yield* new Usage({ message: USAGE });
  return { output, inputs: [first, ...rest] };
});

const load = Effect.fn("load")(function* (path: string) {
  const fs = yield* FileSystem.FileSystem;
  const unread = (cause: { readonly message: string }) => new MergeError({ message: `${path} is not a Stryker mutation report: ${cause.message}` });
  const report = yield* fs.readFileString(path).pipe(Effect.flatMap(decodeReport), Effect.mapError(unread));
  return { path, report };
});

const merge = Effect.gen(function* () {
  const { output, inputs } = yield* parseArgs(process.argv.slice(2));
  const [first, ...rest] = inputs;
  const result = mergeShards([yield* load(first), ...(yield* Effect.forEach(rest, load))]);
  if ("conflict" in result) return yield* new MergeError({ message: result.conflict });
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const written = (cause: { readonly message: string }) => new MergeError({ message: `cannot write ${output}: ${cause.message}` });
  yield* fs.makeDirectory(path.dirname(output), { recursive: true }).pipe(Effect.mapError(written));
  yield* fs.writeFileString(output, `${JSON.stringify(result.merged, null, 2)}\n`).pipe(Effect.mapError(written));
  const mutants = Object.values(result.merged.files).reduce((sum, { mutants: held }) => sum + held.length, 0);
  const tests = Object.values(result.merged.testFiles ?? {}).reduce((sum, { tests: held }) => sum + held.length, 0);
  yield* Console.error(`${NAME}: ${inputs.length} report(s) into ${output}, with ${Object.keys(result.merged.files).length} file(s), ${mutants} mutant(s) and ${tests} test(s)`);
  return true;
});

if (import.meta.main) runMain(NAME, merge);
