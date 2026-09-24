#!/usr/bin/env bun
import { Console, Effect } from "effect";
import { ADR_DIRECTORY, judge, placementOf, placementProblem, type Placement } from "./doc-rules.ts";
import { changedPaths, git, pathsAt, rangeEnds } from "./git.ts";
import { runMain, Usage } from "./main.ts";
import { readQuality } from "./quality-file.ts";

type Finding = {
  readonly path: string;
  readonly line: number | undefined;
  readonly message: string;
};

type Judged = {
  readonly held: readonly string[];
  readonly findings: readonly Finding[];
  readonly advisory: ReadonlyMap<string, number>;
};

const NAME = "docs";
const USAGE = "usage: docs.ts <ref> | <base-ref> <head-ref>";
const MARKDOWN = [":(glob)**/*.md"];

const judgeFile = Effect.fn("judgeFile")(function* (
  root: string,
  head: string,
  path: string,
  placement: Placement,
  records: readonly string[],
) {
  const misplaced = placementProblem(placement);
  if (misplaced !== undefined) return [{ path, line: undefined, message: misplaced }];
  if (placement.type !== "judged") return [];
  const text = yield* git(["show", `${head}:${path}`], root);
  return judge(placement.kind, { path, text }, records).map(({ line, message }) => ({ path, line, message }));
});

const runDocs = Effect.fn("runDocs")(function* (root: string, base: string, head: string) {
  const { quality } = yield* readQuality(root);
  const touched = new Set(
    (yield* changedPaths(base, head, MARKDOWN, root)).flatMap((change) => (change.kind === "deleted" ? [] : [change.path])),
  );
  const present = yield* pathsAt(head, MARKDOWN, root);
  const records = present.filter((path) => path.startsWith(ADR_DIRECTORY));
  const placed = present.map((path) => ({ path, placement: placementOf(path, quality.docs) }));
  const judged = placed.filter(({ placement }) => placement.type !== "unjudged");
  const findings = (yield* Effect.forEach(judged, ({ path, placement }) => judgeFile(root, head, path, placement, records), {
    concurrency: 8,
  })).flat();
  const advisory = new Map<string, number>();
  for (const { path } of findings.filter((finding) => !touched.has(finding.path))) advisory.set(path, (advisory.get(path) ?? 0) + 1);
  return {
    held: judged.map(({ path }) => path).filter((path) => touched.has(path)),
    findings: findings.filter((finding) => touched.has(finding.path)),
    advisory,
  } satisfies Judged;
});

function describe({ path, line, message }: Finding): string {
  return `  ${path}${line === undefined ? "" : `:${line}`}: ${message}`;
}

export function report({ held, findings, advisory }: Judged): string {
  const verdict =
    findings.length === 0
      ? [`${NAME}: ${held.length} doc file(s) the range touches hold to their templates`]
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
