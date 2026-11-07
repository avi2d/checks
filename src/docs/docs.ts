#!/usr/bin/env bun
import { Console, Effect } from "effect";
import { ceilingFinding, entryFindings, isAgentFile, isCeiledReadme, maintainingFinding, missingAgentFiles, readmeFindings } from "./doc-agents.ts";
import { PACKAGE_MANIFEST, rootsOf, snapshotOf, type Snapshot, unresolvedIn, type Judging, type Unresolved } from "./doc-references.ts";
import { ADR_DIRECTORY, judge, placementOf, placementProblem, recordsOf, speaksToConsumers, type Placement, type Records } from "./doc-rules.ts";
import { vanishedNames } from "./doc-names.ts";
import { pinsAt, versionFindings } from "./doc-versions.ts";
import { readTexts, snapshotAt, stillMissing } from "./doc-snapshot.ts";
import { changedLines, changedPaths, git, pathsAt, pathsOf, rangeEnds, refArgs, type Change } from "../core/git.ts";
import { runMain } from "../core/main.ts";
import { proseFindings, readerOf } from "./prose-matchers.ts";
import { longSentences } from "./sentence-length.ts";

type Finding = {
  readonly path: string;
  readonly line: number | undefined;
  readonly message: string;
};

type Judged = {
  readonly held: readonly string[];
  readonly edited: { readonly docs: number; readonly lines: number };
  readonly named: number;
  readonly agents: number;
  readonly readmes: number;
  readonly packageRoot: boolean;
  readonly findings: readonly Finding[];
  readonly advisory: ReadonlyMap<string, number>;
  readonly readmeAdvisory: readonly Finding[];
  readonly agentFileAdvisory: readonly Finding[];
  readonly sentenceAdvisory: readonly Finding[];
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

function editsDocs(changes: readonly Change[]): boolean {
  return changes.some((change) => pathsOf(change).some((path) => readerOf(path) !== undefined));
}

function agentFileFindings(path: string, text: string, tracked: Snapshot): readonly Finding[] {
  const shaped = [ceilingFinding(text), maintainingFinding(text)].flatMap((finding) => (finding === undefined ? [] : [finding]));
  return [...shaped, ...entryFindings(path, text, tracked)].map((finding) => ({ path, ...finding }));
}

function rootAgentFindings(files: ReadonlySet<string>, changes: readonly Change[]): { readonly failing: readonly Finding[]; readonly advisory: readonly Finding[] } {
  const absent = missingAgentFiles(files).map((finding) => ({ ...finding, line: undefined }));
  return editsDocs(changes) ? { failing: absent, advisory: [] } : { failing: [], advisory: absent };
}

function templateFindings(path: string, text: string, placement: Placement, records: Records): readonly Finding[] {
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
  const failed = found.filter((one) => onChangedLines(one) || !before.has(keyOf(one)));
  return {
    failing: failed.map(finding),
    failed,
    brokenBefore: elsewhere.filter((one) => before.has(keyOf(one))).map(finding),
  };
});

const runDocs = Effect.fn("runDocs")(function* (root: string, base: string, head: string) {
  const changes = yield* changedPaths(base, head, MARKDOWN, root);
  const touched = new Set(changes.flatMap((change) => (change.kind === "deleted" ? [] : [change.path])));
  const renamedFrom = new Map(changes.flatMap((change) => (change.kind === "renamed" ? [[change.path, change.from] as const] : [])));
  const changed = yield* changedLines(base, head, MARKDOWN, root);
  const present = yield* pathsAt(head, MARKDOWN, root);
  const proseDocs = present.flatMap((path) => {
    const reader = readerOf(path);
    return reader === undefined ? [] : [{ path, reader }];
  });
  const texts = yield* readTexts(root, head, [...new Set([...present.filter((path) => path.endsWith(".md")), ...proseDocs.map(({ path }) => path)])]);
  const text = (path: string): string => texts.get(path) ?? "";
  const records = recordsOf(present.filter((path) => path.startsWith(ADR_DIRECTORY)).map((path) => ({ path, text: text(path) })));
  const judged = present.map((path) => ({ path, placement: placementOf(path, text(path)) })).filter(({ placement }) => placement.type !== "unjudged");

  const templated = judged.flatMap(({ path, placement }) => templateFindings(path, text(path), placement, records));
  const edited = proseDocs.filter(({ path }) => changed.has(path));
  const prose = edited.flatMap(({ path, reader }) =>
    proseFindings(text(path), reader, changed.get(path)).map(({ line, message }) => ({ path, line, message })),
  );
  const pins = yield* pinsAt(root, head);
  const versions = edited.flatMap(({ path }) =>
    versionFindings(text(path), pins, changed.get(path)).map(({ line, message }) => ({ path, line, message })),
  );
  const sentenceAdvisory = edited
    .flatMap(({ path }) => longSentences(text(path), changed.get(path)).map(({ line, message }) => ({ path, line, message })))
    .toSorted(inPathOrder);
  const judging = (path: string): Judging => ({ commands: !speaksToConsumers(text(path)) });
  // A directory the range deletes still belongs to this repository, so a path under it is stale rather than another repository's.
  const roots = rootsOf(yield* pathsAt(base, [], root));
  const referenced = new Map(proseDocs.map(({ path }) => [path, text(path)]));
  const references = yield* referenceFindings({ root, base, head, roots, changed, renamedFrom }, referenced, judging);
  const vanished = yield* vanishedNames(root, base, head, referenced, references.failed);
  const agents = proseDocs.filter(({ path }) => isAgentFile(path));
  const tracked = snapshotOf(yield* pathsAt(head, [], root), new Map(), new Map());
  const shapes = agents.flatMap(({ path }) => agentFileFindings(path, text(path), tracked));
  const readmes = proseDocs.filter(({ path }) => isCeiledReadme(path, tracked.files));
  const oversize = readmes.flatMap(({ path }) => readmeFindings(text(path)).map((finding) => ({ path, ...finding })));
  const rootAgents = rootAgentFindings(tracked.files, changes);
  const advisory = new Map<string, number>();
  for (const { path } of templated.filter((finding) => !touched.has(finding.path))) advisory.set(path, (advisory.get(path) ?? 0) + 1);
  return {
    held: judged.map(({ path }) => path).filter((path) => touched.has(path)),
    edited: { docs: edited.length, lines: edited.reduce((sum, { path }) => sum + (changed.get(path)?.size ?? 0), 0) },
    named: referenced.size,
    agents: agents.length,
    readmes: readmes.filter(({ path }) => touched.has(path)).length,
    packageRoot: tracked.files.has(PACKAGE_MANIFEST),
    findings: [
      ...templated.filter((finding) => touched.has(finding.path)),
      ...prose,
      ...versions,
      ...references.failing,
      ...vanished,
      ...shapes,
      ...oversize.filter((finding) => touched.has(finding.path)),
      ...rootAgents.failing,
    ].toSorted(inPathOrder),
    advisory,
    readmeAdvisory: oversize.filter((finding) => !touched.has(finding.path)).toSorted(inPathOrder),
    agentFileAdvisory: rootAgents.advisory,
    sentenceAdvisory,
    brokenBefore: references.brokenBefore.toSorted(inPathOrder),
  } satisfies Judged;
});

function describe({ path, line, message }: Finding): string {
  return `  ${path}${line === undefined ? "" : `:${line}`}: ${message}`;
}

export function report({
  held,
  edited,
  named,
  agents,
  readmes,
  packageRoot,
  findings,
  advisory,
  readmeAdvisory,
  agentFileAdvisory,
  sentenceAdvisory,
  brokenBefore,
}: Judged): string {
  const rootAgentFiles =
    packageRoot && agentFileAdvisory.length === 0 ? [`${NAME}: the repository root holds the AGENTS.md and CLAUDE.md its package.json calls for`] : [];
  const verdict =
    findings.length === 0
      ? [
          `${NAME}: ${held.length} doc file(s) the range touches hold to their templates`,
          `${NAME}: ${edited.lines} line(s) the range adds or edits in ${edited.docs} living doc(s) or agent file(s) hold to the prose rules`,
          `${NAME}: no line the range adds or edits copies a version package.json or .bun-version pins`,
          `${NAME}: the range breaks no path, link or command the ${named} living doc(s) or agent file(s) name`,
          `${NAME}: the ${agents} agent file(s) hold to the ceiling, and every entry names a tracked path, a link or a command`,
          `${NAME}: the ${readmes} README(s) the range edits hold to the 6,000-character ceiling and the 300-character table cell ceiling`,
          ...rootAgentFiles,
        ]
      : [`${NAME}: ${findings.length} violation(s):`, ...findings.map(describe)];
  const unconformed =
    advisory.size === 0
      ? []
      : [
          `${NAME}: advisory, ${advisory.size} doc file(s) the range leaves alone do not hold to their templates yet:`,
          ...[...advisory].map(([path, count]) => `  ${path}: ${count} violation(s)`),
        ];
  const oversize =
    readmeAdvisory.length === 0
      ? []
      : [`${NAME}: advisory, ${readmeAdvisory.length} README ceiling finding(s) in README(s) the range leaves alone:`, ...readmeAdvisory.map(describe)];
  const missing =
    agentFileAdvisory.length === 0
      ? []
      : [
          `${NAME}: advisory, ${agentFileAdvisory.length} agent file(s) missing from the repository root, which the first range that edits a living doc or an agent file adds:`,
          ...agentFileAdvisory.map(describe),
        ];
  const sentences =
    sentenceAdvisory.length === 0
      ? []
      : [
          `${NAME}: advisory, ${sentenceAdvisory.length} sentence(s) over the trial length caps:`,
          ...sentenceAdvisory.map(describe),
        ];
  const broken =
    brokenBefore.length === 0
      ? []
      : [
          `${NAME}: advisory, ${brokenBefore.length} path(s), link(s) or command(s) the living docs or agent files name were broken before the range:`,
          ...brokenBefore.map(describe),
        ];
  return [...verdict, ...unconformed, ...oversize, ...missing, ...sentences, ...broken].join("\n");
}

const docs = Effect.gen(function* () {
  const { first, second } = yield* refArgs(process.argv.slice(2), USAGE);

  const root = (yield* git(["rev-parse", "--show-toplevel"])).trim();
  const { base, head } = yield* rangeEnds(first, second, root);
  const judged = yield* runDocs(root, base, head);

  yield* Console.log(report(judged));
  return judged.findings.length === 0;
});

if (import.meta.main) runMain(NAME, docs);
