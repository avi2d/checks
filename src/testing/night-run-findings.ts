import { Option, Schema } from "effect";
import { OUTCOME, type ReportFile } from "./mutation-compare.ts";
import { NAME_SEPARATOR, type TestResult } from "./test-report.ts";

const ScoreSchema = Schema.Struct({ detected: Schema.Int, valid: Schema.Int });

export type Score = typeof ScoreSchema.Type;

export const NightRecordSchema = Schema.Struct({ scores: Schema.Record(Schema.String, ScoreSchema) });

export type NightRecord = typeof NightRecordSchema.Type;

export type TestReport = { readonly results: readonly TestResult[]; readonly crashedFiles: readonly string[] };

export type Tonight = { readonly scores: NightRecord["scores"]; readonly tests: readonly TestReport[] };

export type PreviousNight = { readonly url: string; readonly record: NightRecord };

export type Finding =
  | { readonly kind: "mutation"; readonly file: string; readonly before: Score; readonly after: Score; readonly since: string }
  | { readonly kind: "test"; readonly file: string; readonly name: string }
  | { readonly kind: "crash"; readonly file: string }
  | { readonly kind: "gates"; readonly file: string };

function scoreOf(file: ReportFile): Score {
  let detected = 0;
  let valid = 0;
  for (const mutant of file.mutants) {
    const outcome = OUTCOME[mutant.status];
    if (outcome === "leaves-score") continue;
    valid += 1;
    if (outcome === "detected") detected += 1;
  }
  return { detected, valid };
}

export function scoresOf(files: ReadonlyMap<string, ReportFile>): NightRecord["scores"] {
  return Object.fromEntries([...files].map(([path, file]) => [path, scoreOf(file)] as const).sort(([one], [other]) => one.localeCompare(other)));
}

// Cross-multiplied, so two equal scores never differ by how their quotients round.
function fell(before: Score, after: Score): boolean {
  return before.valid > 0 && after.valid > 0 && after.detected * before.valid < before.detected * after.valid;
}

export function keyOf(finding: Finding): string {
  if (finding.kind === "mutation") return `mutation:${finding.file}`;
  if (finding.kind === "test") return `test:${finding.file}${NAME_SEPARATOR}${finding.name}`;
  if (finding.kind === "gates") return `gates:${finding.file}`;
  return `test:${finding.file}`;
}

function scoreFindings(previous: Option.Option<PreviousNight>, scores: NightRecord["scores"]): readonly Finding[] {
  if (Option.isNone(previous)) return [];
  const { url, record } = previous.value;
  return Object.entries(scores).flatMap(([file, after]): readonly Finding[] => {
    const before = record.scores[file];
    return before !== undefined && fell(before, after) ? [{ kind: "mutation", file, before, after, since: url }] : [];
  });
}

function testFindings(reports: readonly TestReport[]): readonly Finding[] {
  const failing = reports.flatMap(({ results, crashedFiles }) => [
    ...results.filter((result) => result.outcome === "failed").map((result): Finding => ({ kind: "test", file: result.file, name: result.name })),
    ...crashedFiles.map((file): Finding => ({ kind: "crash", file })),
  ]);
  return [...new Map(failing.map((finding) => [keyOf(finding), finding])).values()];
}

export function findingsOf(previous: Option.Option<PreviousNight>, tonight: Tonight, gates: readonly Finding[] = []): readonly Finding[] {
  return [...scoreFindings(previous, tonight.scores), ...testFindings(tonight.tests), ...gates].sort((one, other) =>
    keyOf(one).localeCompare(keyOf(other)),
  );
}

const FAILED_GATES = /of \d+ gate\(s\) failed: (.+)/;
const PASSED_GATES = /gate\(s\) pass/;

export function gatesOf(log: string): readonly Finding[] {
  const names = log
    .split("\n")
    .flatMap((line) => FAILED_GATES.exec(line)?.[1]?.split(",") ?? [])
    .map((name) => name.trim())
    .filter((name) => name !== "");
  if (names.length > 0) return [...new Map(names.map((file): [string, Finding] => [file, { kind: "gates", file }])).values()];
  return PASSED_GATES.test(log) ? [] : [{ kind: "gates", file: "checks-lint" }];
}

export function percent(score: Score): string {
  return `${((score.detected / score.valid) * 100).toFixed(2)}%`;
}
