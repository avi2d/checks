#!/usr/bin/env bun
import { Console, Effect } from "effect";
import { rootsOf, unresolvedIn, type Judging, type Unresolved } from "./doc-references.ts";
import { ADR_DIRECTORY, judge, placementOf, placementProblem, type Placement } from "./doc-rules.ts";
import { readTexts, snapshotAt, stillMissing } from "./doc-snapshot.ts";
import { changedLines, changedPaths, git, pathsAt, rangeEnds } from "./git.ts";
import { runMain, Usage } from "./main.ts";
import { isLivingDoc, proseFindings, readerOf } from "./prose-matchers.ts";
import { readQuality } from "./quality-file.ts";

type Finding = {
  readonly path: string;
  readonly line: number | undefined;
  readonly message: string;
};

type Judged = {
  readonly held: readonly string[];
  readonly edited: { readonly docs: number; readonly lines: number };
  readonly living: number;
  readonly findings: readonly Finding[];
  readonly advisory: ReadonlyMap<string, number>;
  readonly brokenBefore: readonly Finding[];
};

type Range = {
  readonly root: string;
  readonly base: string;
  readonly head: string;
  readonly roots: readonly string[];
  readonly changed: ReadonlyMap<string, ReadonlySet<number>>;
  readonly renamedFrom: ReadonlyMap<string, string>;
};

type Located = Unresolved & { readonly path: string };

const NAME = "docs";
const USAGE = "usage: docs.ts <ref> | <base-ref> <head-ref>";
const MARKDOWN = [":(glob)**/*.md"];

function templateFindings(path: string, text: string, placement: Placement, records: readonly string[]): readonly Finding[] {
  const misplaced = placementProblem(placement);
  if (misplaced !== undefined) return [{ path, line: undefined, message: misplaced }];
  if (placement.type !== "judged") return [];
  return judge(placement.kind, { path, text }, records).map(({ line, message }) => ({ path, line, message }));
}

function inPathOrder(a: Finding, b: Finding): number {
  return a.path === b.path ? (a.line ?? 0) - (b.line ?? 0) : a.path < b.path ? -1 : 1;
}

function locate(path: string, text: string, snapshot: Parameters<typeof unresolvedIn>[2], judging: Judging): readonly Located[] {
  return unresolvedIn(path, text, snapshot, judging).map((unresolved) => ({ ...unresolved, path }));
}

const keyOf = ({ path, kind, named }: Located): string => `${path}\0${kind}\0${named}`;

// A reference on a line the range leaves alone fails only when the range broke it, as by deleting the file it names.
const brokenBeforeRange = Effect.fn("brokenBeforeRange")(function* (range: Range, found: readonly Located[], judging: (path: string) => Judging) {
  const earlier = new Set(yield* pathsAt(range.base, MARKDOWN, range.root));
  const docs = [...new Set(found.map(({ path }) => path))]
    .map((path) => ({ path, from: range.renamedFrom.get(path) ?? path }))
    .filter(({ from }) => earlier.has(from));
  const texts = yield* readTexts(range.root, range.base, docs.map(({ from }) => from));
  const snapshot = yield* snapshotAt(range.root, range.base, texts, range.roots);
  return new Set(docs.flatMap(({ path, from }) => locate(from, texts.get(from) ?? "", snapshot, judging(path)).map((one) => keyOf({ ...one, path }))));
});

const referenceFindings = Effect.fn("referenceFindings")(function* (range: Range, texts: ReadonlyMap<string, string>, judging: (path: string) => Judging) {
  const snapshot = yield* snapshotAt(range.root, range.head, texts, range.roots);
  const unresolved = [...texts].flatMap(([path, text]) => locate(path, text, snapshot, judging(path)));
  const missing = yield* stillMissing(range.root, unresolved);
  const found = unresolved.filter((_, index) => missing[index] === true);
  const onChangedLines = (one: Located): boolean => range.changed.get(one.path)?.has(one.line) === true;
  const elsewhere = found.filter((one) => !onChangedLines(one));
  const before = elsewhere.length === 0 ? new Set<string>() : yield* brokenBeforeRange(range, elsewhere, judging);
  const finding = ({ path, line, message }: Located): Finding => ({ path, line, message });
  return {
    failing: found.filter((one) => onChangedLines(one) || !before.has(keyOf(one))).map(finding),
    brokenBefore: elsewhere.filter((one) => before.has(keyOf(one))).map(finding),
  };
});

const runDocs = Effect.fn("runDocs")(function* (root: string, base: string, head: string) {
  const { quality } = yield* readQuality(root);
  const changes = yield* changedPaths(base, head, MARKDOWN, root);
  const touched = new Set(changes.flatMap((change) => (change.kind === "deleted" ? [] : [change.path])));
  const renamedFrom = new Map(changes.flatMap((change) => (change.kind === "renamed" ? [[change.path, change.from] as const] : [])));
  const changed = yield* changedLines(base, head, MARKDOWN, root);
  const present = yield* pathsAt(head, MARKDOWN, root);
  const records = present.filter((path) => path.startsWith(ADR_DIRECTORY));
  const judged = present.map((path) => ({ path, placement: placementOf(path, quality.docs) })).filter(({ placement }) => placement.type !== "unjudged");
  const living = present.filter(isLivingDoc);
  const proseDocs = present.flatMap((path) => {
    const reader = readerOf(path);
    return reader === undefined ? [] : [{ path, reader }];
  });
  const texts = yield* readTexts(root, head, [...new Set([...judged.map(({ path }) => path), ...proseDocs.map(({ path }) => path)])]);
  const text = (path: string): string => texts.get(path) ?? "";

  const templated = judged.flatMap(({ path, placement }) => templateFindings(path, text(path), placement, records));
  const edited = proseDocs.filter(({ path }) => changed.has(path));
  const prose = edited.flatMap(({ path, reader }) =>
    proseFindings(text(path), reader, changed.get(path)).map(({ line, message }) => ({ path, line, message })),
  );
  const forConsumers = (quality.docs?.forConsumers ?? []).map((glob) => new Bun.Glob(glob));
  const judging = (path: string): Judging => ({ commands: !forConsumers.some((glob) => glob.match(path)) });
  // A directory the range deletes still belongs to this repository, so a path under it is stale rather than another repository's.
  const roots = rootsOf(yield* pathsAt(base, [], root));
  const references = yield* referenceFindings(
    { root, base, head, roots, changed, renamedFrom },
    new Map(living.map((path) => [path, text(path)])),
    judging,
  );
  const advisory = new Map<string, number>();
  for (const { path } of templated.filter((finding) => !touched.has(finding.path))) advisory.set(path, (advisory.get(path) ?? 0) + 1);
  return {
    held: judged.map(({ path }) => path).filter((path) => touched.has(path)),
    edited: { docs: edited.length, lines: edited.reduce((sum, { path }) => sum + (changed.get(path)?.size ?? 0), 0) },
    living: living.length,
    findings: [...templated.filter((finding) => touched.has(finding.path)), ...prose, ...references.failing].toSorted(inPathOrder),
    advisory,
    brokenBefore: references.brokenBefore.toSorted(inPathOrder),
  } satisfies Judged;
});

function describe({ path, line, message }: Finding): string {
  return `  ${path}${line === undefined ? "" : `:${line}`}: ${message}`;
}

export function report({ held, edited, living, findings, advisory, brokenBefore }: Judged): string {
  const verdict =
    findings.length === 0
      ? [
          `${NAME}: ${held.length} doc file(s) the range touches hold to their templates`,
          `${NAME}: ${edited.lines} line(s) the range adds or edits in ${edited.docs} living doc(s) or agent file(s) hold to the prose rules`,
          `${NAME}: the range breaks no path, link or command the ${living} living doc(s) name`,
        ]
      : [`${NAME}: ${findings.length} violation(s):`, ...findings.map(describe)];
  const unconformed =
    advisory.size === 0
      ? []
      : [
          `${NAME}: advisory, ${advisory.size} doc file(s) the range leaves alone do not hold to their templates yet:`,
          ...[...advisory].map(([path, count]) => `  ${path}: ${count} violation(s)`),
        ];
  const broken =
    brokenBefore.length === 0
      ? []
      : [`${NAME}: advisory, ${brokenBefore.length} path(s), link(s) or command(s) the living docs name were broken before the range:`, ...brokenBefore.map(describe)];
  return [...verdict, ...unconformed, ...broken].join("\n");
}

const docs = Effect.gen(function* () {
  const [first, second, ...extra] = process.argv.slice(2);
  if (first === undefined || extra.length > 0) return yield* new Usage({ message: USAGE });

  const root = (yield* git(["rev-parse", "--show-toplevel"])).trim();
  const { base, head } = yield* rangeEnds(first, second, root);
  const judged = yield* runDocs(root, base, head);

  yield* Console.log(report(judged));
  return judged.findings.length === 0;
});

if (import.meta.main) runMain(NAME, docs);
