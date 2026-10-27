#!/usr/bin/env bun
import { Console, Effect, Schema } from "effect";
import { git, commitOf, emptyTree, parentOrEmptyTree, refArgs } from "../core/git.ts";
import { WHOLE_TREE } from "../core/gates.ts";
import { Usage, runMain } from "../core/main.ts";

export const SUPPRESSIONS = ["oxlint-suppressions.json", "stylelint-suppressions.json"] as const;

export type SuppressionsFile = (typeof SUPPRESSIONS)[number];

export type Suppressions = ReadonlyMap<string, ReadonlyMap<string, number>>;

type Place = { readonly list: SuppressionsFile; readonly file: string; readonly rule: string };

export type Rise = Place & ({ readonly kind: "rose"; readonly base: number; readonly head: number } | { readonly kind: "appeared"; readonly head: number });

export type Ratchet = {
  readonly counted: number;
  readonly lowered: number;
  readonly rises: readonly Rise[];
};

export class SuppressionsError extends Schema.TaggedError<SuppressionsError>()("SuppressionsError", {
  message: Schema.String,
}) {}

const USAGE = "usage: suppressions-ratchet.ts <ref> | <base-ref> <head-ref> | --whole-tree <head-ref>";

const parseJson = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown));
const decodeObject = Schema.decodeUnknownEffect(Schema.Record(Schema.String, Schema.Unknown));
const decodeEntry = Schema.decodeUnknownEffect(Schema.Struct({ count: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)) }));

export const parseSuppressions = Effect.fn("parseSuppressions")(function* (
  text: string,
  where: string,
): Effect.fn.Return<Suppressions, SuppressionsError> {
  const refuse = (reason: string) => () => new SuppressionsError({ message: `${where} ${reason}` });
  const parsed = yield* parseJson(text).pipe(Effect.mapError(refuse("is not valid JSON")));
  const files = yield* decodeObject(parsed).pipe(Effect.mapError(refuse("is not an object of files")));
  const suppressions = new Map<string, ReadonlyMap<string, number>>();
  for (const [file, rules] of Object.entries(files)) {
    const entries = yield* decodeObject(rules).pipe(Effect.mapError(refuse(`holds ${file} without an object of rules`)));
    const counts = new Map<string, number>();
    for (const [rule, entry] of Object.entries(entries)) {
      const { count } = yield* decodeEntry(entry).pipe(
        Effect.mapError(refuse(`holds ${file} ${rule} without a whole count`)),
      );
      counts.set(rule, count);
    }
    suppressions.set(file, counts);
  }
  return suppressions;
});

type Count = Place & { readonly count: number };

function countsOf(list: SuppressionsFile, suppressions: Suppressions): readonly Count[] {
  return [...suppressions].flatMap(([file, rules]) => [...rules].map(([rule, count]) => ({ list, file, rule, count })));
}

function riseOf({ count, ...place }: Count, before: number | undefined): readonly Rise[] {
  if (before === undefined) return count > 0 ? [{ ...place, kind: "appeared", head: count }] : [];
  return count > before ? [{ ...place, kind: "rose", base: before, head: count }] : [];
}

export function compareSuppressions(list: SuppressionsFile, base: Suppressions, head: Suppressions): Ratchet {
  const counts = countsOf(list, head);
  const rises = counts.flatMap((counted) => riseOf(counted, base.get(counted.file)?.get(counted.rule)));
  const lowered = countsOf(list, base).filter(({ file, rule, count }) => (head.get(file)?.get(rule) ?? 0) < count).length;
  rises.sort((a, b) => a.file.localeCompare(b.file) || a.rule.localeCompare(b.rule));
  return { counted: counts.length, lowered, rises };
}

export function combined(ratchets: readonly Ratchet[]): Ratchet {
  return {
    counted: ratchets.reduce((sum, { counted }) => sum + counted, 0),
    lowered: ratchets.reduce((sum, { lowered }) => sum + lowered, 0),
    rises: ratchets.flatMap(({ rises }) => rises),
  };
}

function describeRise(rise: Rise): string {
  const change = rise.kind === "rose" ? `rose from ${rise.base} to ${rise.head}` : `appeared with ${rise.head}`;
  return `${rise.list} ${rise.file} ${rise.rule} ${change}`;
}

export function report({ counted, lowered, rises }: Ratchet): string {
  if (rises.length === 0) {
    return `suppressions-ratchet: no count in ${SUPPRESSIONS.join(" or ")} rose or appeared (${counted} at the head, ${lowered} lowered)`;
  }
  return [
    `suppressions-ratchet: ${rises.length} count(s) rose or appeared; fix the site instead of suppressing it:`,
    ...rises.map((rise) => `  ${describeRise(rise)}`),
  ].join("\n");
}

const mergeBase = Effect.fn("mergeBase")(function* (base: string, head: string) {
  const commit = yield* git(["merge-base", base, head]).pipe(
    Effect.mapError(() => new SuppressionsError({ message: `${base} and ${head} share no commit` })),
  );
  return commit.trim();
});

const suppressionsAt = Effect.fn("suppressionsAt")(function* (list: SuppressionsFile, treeish: string) {
  const blob = (yield* git(["ls-tree", "--object-only", treeish, "--", list])).trim();
  if (blob === "") return new Map() satisfies Suppressions;
  return yield* parseSuppressions(yield* git(["cat-file", "blob", blob]), `${list} at ${treeish}`);
});

const compareAt = Effect.fn("compareAt")(function* (base: string, head: string) {
  const ratchets: Ratchet[] = [];
  for (const list of SUPPRESSIONS) ratchets.push(compareSuppressions(list, yield* suppressionsAt(list, base), yield* suppressionsAt(list, head)));
  return combined(ratchets);
});

export const runRange = Effect.fn("runRange")(function* (base: string, head: string) {
  const headCommit = yield* commitOf(head);
  // At the base tip, a count the base branch lowered after the head branched off would read as a rise at the head.
  const branchPoint = yield* mergeBase(yield* commitOf(base), headCommit);
  return yield* compareAt(branchPoint, headCommit);
});

export const runTip = Effect.fn("runTip")(function* (tip: string) {
  const tipCommit = yield* commitOf(tip);
  return yield* compareAt(yield* parentOrEmptyTree(tipCommit), tipCommit);
});

export const runWholeTree = Effect.fn("runWholeTree")(function* (head: string) {
  return yield* compareAt(yield* emptyTree(), yield* commitOf(head));
});

const ratchet = Effect.gen(function* () {
  const { first, second } = yield* refArgs(process.argv.slice(2), USAGE);
  if (first === WHOLE_TREE) {
    if (second === undefined) return yield* new Usage({ message: USAGE });
    const whole = yield* runWholeTree(second);
    yield* Console.log(report(whole));
    return whole.rises.length === 0;
  }
  const result = second !== undefined ? yield* runRange(first, second) : yield* runTip(first);
  yield* Console.log(report(result));
  return result.rises.length === 0;
});

if (import.meta.main) runMain("suppressions-ratchet", ratchet);
