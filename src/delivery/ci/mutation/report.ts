import { Schema } from "effect";

const Mutant = Schema.Struct({ status: Schema.String });

export const Report = Schema.Struct({ files: Schema.Record(Schema.String, Schema.Struct({ mutants: Schema.Array(Mutant) })) });

export type Report = typeof Report.Type;

const DETECTED = new Set(["Killed", "Timeout"]);
const SCORED = new Set([...DETECTED, "Survived", "NoCoverage"]);

type Score = { readonly detected: number; readonly total: number };

function scoreOf(files: Report["files"]): Score {
  const scored = Object.values(files).flatMap(({ mutants }) => mutants.filter(({ status }) => SCORED.has(status)));
  return { detected: scored.filter(({ status }) => DETECTED.has(status)).length, total: scored.length };
}

function scoreLine({ detected, total }: Score): string {
  if (total === 0) return `Detected ${detected} of ${total} mutants.`;
  return `Detected ${detected} of ${total} mutants (${Math.floor((100 * detected + Math.floor(total / 2)) / total)}%).`;
}

export function scoreSummary(title: string, report: Report | undefined): string {
  return `## ${title}\n\n${report === undefined ? "No report was written." : scoreLine(scoreOf(report.files))}\n`;
}

export const SHARD_DIRECTORY = "reports/shard";
export const DOWNLOADED_DIRECTORY = "shards";
export const STATE_PREFIX = "state-";
const STOPPED_PREFIX = "stopped-";

export const stateName = (index: string): string => `${STATE_PREFIX}${index}.json`;

export const stoppedName = (index: string): string => `${STOPPED_PREFIX}${index}`;

export const anyStopped = (names: readonly string[]): boolean => names.some((name) => name.startsWith(STOPPED_PREFIX));

export function shardsOf(scopeOutput: string): string | undefined {
  const line = scopeOutput.split("\n").find((candidate) => candidate.startsWith("SHARDS="));
  return line?.slice("SHARDS=".length);
}
