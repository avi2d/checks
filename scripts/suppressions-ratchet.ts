#!/usr/bin/env bun
export const SUPPRESSIONS = "oxlint-suppressions.json";

export type Suppressions = ReadonlyMap<string, ReadonlyMap<string, number>>;

export type Rise =
  | { readonly kind: "rose"; readonly file: string; readonly rule: string; readonly base: number; readonly head: number }
  | { readonly kind: "appeared"; readonly file: string; readonly rule: string; readonly head: number };

export type Ratchet = {
  readonly counted: number;
  readonly lowered: number;
  readonly rises: readonly Rise[];
};

export class SuppressionsError extends Error {}

const USAGE = "usage: suppressions-ratchet.ts <ref> | <base-ref> <head-ref>";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

export function parseSuppressions(text: string, where: string): Suppressions {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new SuppressionsError(`suppressions-ratchet: ${where} is not valid JSON`);
  }
  if (!isRecord(parsed)) {
    throw new SuppressionsError(`suppressions-ratchet: ${where} is not an object of files`);
  }
  const files = new Map<string, ReadonlyMap<string, number>>();
  for (const [file, rules] of Object.entries(parsed)) {
    if (!isRecord(rules)) {
      throw new SuppressionsError(`suppressions-ratchet: ${where} holds ${file} without an object of rules`);
    }
    const counts = new Map<string, number>();
    for (const [rule, entry] of Object.entries(rules)) {
      if (!isRecord(entry) || !isCount(entry["count"])) {
        throw new SuppressionsError(`suppressions-ratchet: ${where} holds ${file} ${rule} without a whole count`);
      }
      counts.set(rule, entry["count"]);
    }
    files.set(file, counts);
  }
  return files;
}

export function compareSuppressions(base: Suppressions, head: Suppressions): Ratchet {
  const rises: Rise[] = [];
  let counted = 0;
  for (const [file, rules] of head) {
    for (const [rule, count] of rules) {
      counted += 1;
      const before = base.get(file)?.get(rule);
      if (before === undefined) {
        if (count > 0) rises.push({ kind: "appeared", file, rule, head: count });
      } else if (count > before) {
        rises.push({ kind: "rose", file, rule, base: before, head: count });
      }
    }
  }
  let lowered = 0;
  for (const [file, rules] of base) {
    for (const [rule, count] of rules) {
      if ((head.get(file)?.get(rule) ?? 0) < count) lowered += 1;
    }
  }
  rises.sort((a, b) => a.file.localeCompare(b.file) || a.rule.localeCompare(b.rule));
  return { counted, lowered, rises };
}

function describeRise(rise: Rise): string {
  const change = rise.kind === "rose" ? `rose from ${rise.base} to ${rise.head}` : `appeared with ${rise.head}`;
  return `${rise.file} ${rise.rule} ${change}`;
}

export function report({ counted, lowered, rises }: Ratchet): string {
  if (rises.length === 0) {
    return `suppressions-ratchet: no count in ${SUPPRESSIONS} rose or appeared (${counted} at the head, ${lowered} lowered)`;
  }
  return [
    `suppressions-ratchet: ${rises.length} count(s) in ${SUPPRESSIONS} rose or appeared; fix the site instead of suppressing it:`,
    ...rises.map((rise) => `  ${describeRise(rise)}`),
  ].join("\n");
}

function die(message: string): never {
  console.error(message);
  process.exit(2);
}

function git(...args: readonly string[]): string {
  const result = Bun.spawnSync(["git", ...args], { stdout: "pipe", stderr: "pipe" });
  if (!result.success) {
    die(`suppressions-ratchet: git ${args.join(" ")}: ${result.stderr.toString().trim()}`);
  }
  return result.stdout.toString();
}

function commitOf(rev: string): string {
  return git("rev-parse", "--verify", `${rev}^{commit}`).trim();
}

function mergeBase(base: string, head: string): string {
  const result = Bun.spawnSync(["git", "merge-base", base, head], { stdout: "pipe", stderr: "pipe" });
  if (!result.success) die(`suppressions-ratchet: ${base} and ${head} share no commit`);
  return result.stdout.toString().trim();
}

function suppressionsAt(commit: string): Suppressions {
  const blob = git("ls-tree", "--object-only", commit, "--", SUPPRESSIONS).trim();
  if (blob === "") return new Map();
  try {
    return parseSuppressions(git("cat-file", "blob", blob), `${SUPPRESSIONS} at ${commit}`);
  } catch (error) {
    return die(error instanceof SuppressionsError ? error.message : `suppressions-ratchet: ${String(error)}`);
  }
}

export function runRange(base: string, head: string): Ratchet {
  const headCommit = commitOf(head);
  // At the base tip, a count the base branch lowered after the head branched off would read as a rise at the head.
  const branchPoint = mergeBase(commitOf(base), headCommit);
  return compareSuppressions(suppressionsAt(branchPoint), suppressionsAt(headCommit));
}

if (import.meta.main) {
  const [first, second, ...extra] = process.argv.slice(2);
  if (first === undefined || extra.length > 0) die(USAGE);

  const ratchet = second !== undefined ? runRange(first, second) : runRange(`${first}^`, first);

  console.log(report(ratchet));
  process.exit(ratchet.rises.length === 0 ? 0 : 1);
}
