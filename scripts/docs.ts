#!/usr/bin/env bun
import { Console, Effect } from "effect";
import { ADR_DIRECTORY, judge, placementOf, placementProblem, type Placement } from "./doc-rules.ts";
import { changedLines, changedPaths, git, pathsAt, rangeEnds } from "./git.ts";
import { runMain, Usage } from "./main.ts";
import { isLivingDoc, proseFindings } from "./prose-matchers.ts";
import { readQuality } from "./quality-file.ts";

type Finding = {
  readonly path: string;
  readonly line: number | undefined;
  readonly message: string;
};

type Judged = {
  readonly held: readonly string[];
  readonly edited: { readonly docs: number; readonly lines: number };
  readonly findings: readonly Finding[];
  readonly advisory: ReadonlyMap<string, number>;
};

const NAME = "docs";
const USAGE = "usage: docs.ts <ref> | <base-ref> <head-ref>";
const MARKDOWN = [":(glob)**/*.md"];

const readTexts = Effect.fn("readTexts")(function* (root: string, rev: string, paths: readonly string[]) {
  const texts = yield* Effect.forEach(paths, (path) => git(["show", `${rev}:${path}`], root), { concurrency: 8 });
  return new Map(paths.map((path, index) => [path, texts[index] ?? ""]));
});

function templateFindings(path: string, text: string, placement: Placement, records: readonly string[]): readonly Finding[] {
  const misplaced = placementProblem(placement);
  if (misplaced !== undefined) return [{ path, line: undefined, message: misplaced }];
  if (placement.type !== "judged") return [];
  return judge(placement.kind, { path, text }, records).map(({ line, message }) => ({ path, line, message }));
}

function inPathOrder(a: Finding, b: Finding): number {
  return a.path === b.path ? (a.line ?? 0) - (b.line ?? 0) : a.path < b.path ? -1 : 1;
}

const runDocs = Effect.fn("runDocs")(function* (root: string, base: string, head: string) {
  const { quality } = yield* readQuality(root);
  const touched = new Set(
    (yield* changedPaths(base, head, MARKDOWN, root)).flatMap((change) => (change.kind === "deleted" ? [] : [change.path])),
  );
  const changed = yield* changedLines(base, head, MARKDOWN, root);
  const present = yield* pathsAt(head, MARKDOWN, root);
  const records = present.filter((path) => path.startsWith(ADR_DIRECTORY));
  const judged = present.map((path) => ({ path, placement: placementOf(path, quality.docs) })).filter(({ placement }) => placement.type !== "unjudged");
  const edited = present.filter((path) => isLivingDoc(path) && changed.has(path));
  const texts = yield* readTexts(root, head, [...new Set([...judged.map(({ path }) => path), ...edited])]);
  const text = (path: string): string => texts.get(path) ?? "";

  const templated = judged.flatMap(({ path, placement }) => templateFindings(path, text(path), placement, records));
  const prose = edited.flatMap((path) => proseFindings(text(path), changed.get(path)).map(({ line, message }) => ({ path, line, message })));
  const advisory = new Map<string, number>();
  for (const { path } of templated.filter((finding) => !touched.has(finding.path))) advisory.set(path, (advisory.get(path) ?? 0) + 1);
  return {
    held: judged.map(({ path }) => path).filter((path) => touched.has(path)),
    edited: { docs: edited.length, lines: edited.reduce((sum, path) => sum + (changed.get(path)?.size ?? 0), 0) },
    findings: [...templated.filter((finding) => touched.has(finding.path)), ...prose].toSorted(inPathOrder),
    advisory,
  } satisfies Judged;
});

function describe({ path, line, message }: Finding): string {
  return `  ${path}${line === undefined ? "" : `:${line}`}: ${message}`;
}

export function report({ held, edited, findings, advisory }: Judged): string {
  const verdict =
    findings.length === 0
      ? [
          `${NAME}: ${held.length} doc file(s) the range touches hold to their templates`,
          `${NAME}: ${edited.lines} line(s) the range adds or edits in ${edited.docs} living doc(s) hold to the prose rules`,
        ]
      : [`${NAME}: ${findings.length} violation(s) in the doc files the range touches:`, ...findings.map(describe)];
  const notice =
    advisory.size === 0
      ? []
      : [
          `${NAME}: advisory, ${advisory.size} doc file(s) the range leaves alone do not hold to their templates yet:`,
          ...[...advisory].map(([path, count]) => `  ${path}: ${count} violation(s)`),
        ];
  return [...verdict, ...notice].join("\n");
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
