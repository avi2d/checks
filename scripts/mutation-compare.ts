#!/usr/bin/env bun
import { readFile } from "node:fs/promises";

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

export class ReportError extends Error {}

const DETECTED = new Set(["Killed", "Timeout"]);
const UNDETECTED = new Set(["Survived", "NoCoverage"]);
const USAGE = "usage: mutation-compare.ts [--advisory] <base-report> <head-report>";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function parseReport(text: string): Map<string, readonly string[]> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ReportError("mutation-compare: report is not valid JSON");
  }
  if (!isRecord(parsed) || !isRecord(parsed["files"])) {
    throw new ReportError("mutation-compare: report has no files table");
  }
  const files = new Map<string, readonly string[]>();
  for (const [path, entry] of Object.entries(parsed["files"])) {
    if (!isRecord(entry) || !Array.isArray(entry["mutants"])) {
      throw new ReportError(`mutation-compare: ${path} has no mutants list`);
    }
    const statuses: string[] = [];
    for (const mutant of entry["mutants"]) {
      if (!isRecord(mutant) || typeof mutant["status"] !== "string") {
        throw new ReportError(`mutation-compare: ${path} carries a mutant without a status`);
      }
      statuses.push(mutant["status"]);
    }
    files.set(path, statuses);
  }
  return files;
}

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

export function parseArgs(argv: readonly string[]): Options {
  let advisory = false;
  const paths: string[] = [];
  for (const arg of argv) {
    if (arg === "--advisory") advisory = true;
    else if (arg.startsWith("--")) throw new ReportError(`${USAGE}: unknown flag ${arg}`);
    else paths.push(arg);
  }
  if (paths.length !== 2 || paths[0] === undefined || paths[1] === undefined) throw new ReportError(USAGE);
  return { basePath: paths[0], headPath: paths[1], advisory };
}

export function exitFor(comparison: Comparison, advisory: boolean): number {
  return comparison.regression && !advisory ? 1 : 0;
}

async function load(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch {
    throw new ReportError(`mutation-compare: cannot read ${path}`);
  }
}

if (import.meta.main) {
  try {
    const options = parseArgs(process.argv.slice(2));
    const comparison = compareReports(parseReport(await load(options.basePath)), parseReport(await load(options.headPath)));
    console.log(formatComparison(comparison, options.advisory));
    process.exit(exitFor(comparison, options.advisory));
  } catch (error) {
    console.error(error instanceof ReportError ? error.message : `mutation-compare: ${String(error)}`);
    process.exit(2);
  }
}
