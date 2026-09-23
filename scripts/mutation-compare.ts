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
  readonly changed: boolean;
};

export type Comparison = {
  readonly base: Tally;
  readonly head: Tally;
  readonly files: readonly FileComparison[];
  readonly onlyInBase: readonly string[];
  readonly onlyInHead: readonly string[];
  readonly regression: boolean;
};

export type Options = {
  readonly basePath: string;
  readonly headPath: string;
  readonly advisory: boolean;
};

export class ReportError extends Error {}

const KILLED = new Set(["Killed", "Timeout"]);
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
    if (status === "Ignored") continue;
    total += 1;
    if (KILLED.has(status)) killed += 1;
  }
  return { killed, total };
}

function sameStatuses(base: readonly string[], head: readonly string[]): boolean {
  if (base.length !== head.length) return false;
  const ordered = [...base].sort();
  const other = [...head].sort();
  return ordered.every((status, index) => status === other[index]);
}

function add(into: { killed: number; total: number }, count: Tally): void {
  into.killed += count.killed;
  into.total += count.total;
}

export function compareReports(
  baseFiles: ReadonlyMap<string, readonly string[]>,
  headFiles: ReadonlyMap<string, readonly string[]>,
): Comparison {
  const files: FileComparison[] = [];
  const onlyInBase: string[] = [];
  const onlyInHead: string[] = [];
  const baseTotal = { killed: 0, total: 0 };
  const headTotal = { killed: 0, total: 0 };
  for (const path of [...baseFiles.keys()].sort()) {
    const headStatuses = headFiles.get(path);
    if (headStatuses === undefined) {
      onlyInBase.push(path);
      continue;
    }
    const baseStatuses = baseFiles.get(path) ?? [];
    const base = tally(baseStatuses);
    const head = tally(headStatuses);
    const changed = !sameStatuses(baseStatuses, headStatuses);
    files.push({ path, base, head, changed });
    if (changed) {
      add(baseTotal, base);
      add(headTotal, head);
    }
  }
  for (const path of [...headFiles.keys()].sort()) {
    if (!baseFiles.has(path)) onlyInHead.push(path);
  }
  const base = { killed: baseTotal.killed, total: baseTotal.total };
  const head = { killed: headTotal.killed, total: headTotal.total };
  return { base, head, files, onlyInBase, onlyInHead, regression: regressed(base, head) };
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
  const changed = comparison.files.filter((file) => file.changed);
  const unchanged = comparison.files.length - changed.length;
  const lines = [
    `mutation-compare: base ${describe(comparison.base)} head ${describe(comparison.head)} delta ${deltaPoints(comparison.base, comparison.head)} across ${changed.length} changed file(s)`,
  ];
  for (const file of changed) {
    lines.push(`  ${file.path}: ${percent(file.base)} -> ${percent(file.head)} (${deltaPoints(file.base, file.head)})`);
  }
  if (unchanged > 0) lines.push(`  ${unchanged} unchanged file(s) at +0.00pp`);
  for (const path of comparison.onlyInBase) lines.push(`  ${path}: only in base (excluded from verdict)`);
  for (const path of comparison.onlyInHead) lines.push(`  ${path}: only in head (excluded from verdict)`);
  if (comparison.regression) {
    lines.push(`mutation-compare: REGRESSION (${deltaPoints(comparison.base, comparison.head)})${advisory ? " in advisory mode, exit 0" : ""}`);
  } else {
    lines.push(`mutation-compare: no regression${advisory ? " (advisory mode, exit 0)" : ""}`);
  }
  return lines.join("\n");
}

export function parseArgs(argv: readonly string[], env: { readonly [key: string]: string | undefined }): Options {
  let advisory = false;
  const paths: string[] = [];
  for (const arg of argv) {
    if (arg === "--advisory") advisory = true;
    else if (arg.startsWith("--")) throw new ReportError(`${USAGE}: unknown flag ${arg}`);
    else paths.push(arg);
  }
  const flag = env["CHECKS_MUTATION_ADVISORY"];
  if (flag !== undefined && ["1", "true", "yes"].includes(flag.toLowerCase())) advisory = true;
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
    const options = parseArgs(process.argv.slice(2), process.env);
    const comparison = compareReports(parseReport(await load(options.basePath)), parseReport(await load(options.headPath)));
    console.log(formatComparison(comparison, options.advisory));
    process.exit(exitFor(comparison, options.advisory));
  } catch (error) {
    console.error(error instanceof ReportError ? error.message : `mutation-compare: ${String(error)}`);
    process.exit(2);
  }
}
