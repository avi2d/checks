#!/usr/bin/env bun
import { Console, Effect, Schema } from "effect";
import { git, parentOrEmptyTree } from "./git.ts";
import { runMain, Usage } from "./main.ts";

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

export class SuppressionsError extends Schema.TaggedError<SuppressionsError>()("SuppressionsError", {
  message: Schema.String,
}) {}

const USAGE = "usage: suppressions-ratchet.ts <ref> | <base-ref> <head-ref>";

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

const commitOf = Effect.fn("commitOf")(function* (rev: string) {
  return (yield* git(["rev-parse", "--verify", `${rev}^{commit}`])).trim();
});

const mergeBase = Effect.fn("mergeBase")(function* (base: string, head: string) {
  const commit = yield* git(["merge-base", base, head]).pipe(
    Effect.mapError(() => new SuppressionsError({ message: `${base} and ${head} share no commit` })),
  );
  return commit.trim();
});

const suppressionsAt = Effect.fn("suppressionsAt")(function* (treeish: string) {
  const blob = (yield* git(["ls-tree", "--object-only", treeish, "--", SUPPRESSIONS])).trim();
  if (blob === "") return new Map() satisfies Suppressions;
  return yield* parseSuppressions(yield* git(["cat-file", "blob", blob]), `${SUPPRESSIONS} at ${treeish}`);
});

export const runRange = Effect.fn("runRange")(function* (base: string, head: string) {
  const headCommit = yield* commitOf(head);
  // At the base tip, a count the base branch lowered after the head branched off would read as a rise at the head.
  const branchPoint = yield* mergeBase(yield* commitOf(base), headCommit);
  return compareSuppressions(yield* suppressionsAt(branchPoint), yield* suppressionsAt(headCommit));
});

export const runTip = Effect.fn("runTip")(function* (tip: string) {
  const tipCommit = yield* commitOf(tip);
  return compareSuppressions(yield* suppressionsAt(yield* parentOrEmptyTree(tipCommit)), yield* suppressionsAt(tipCommit));
});

const ratchet = Effect.gen(function* () {
  const [first, second, ...extra] = process.argv.slice(2);
  if (first === undefined || extra.length > 0) return yield* new Usage({ message: USAGE });

  const result = second !== undefined ? yield* runRange(first, second) : yield* runTip(first);

  yield* Console.log(report(result));
  return result.rises.length === 0;
});

if (import.meta.main) runMain("suppressions-ratchet", ratchet);
