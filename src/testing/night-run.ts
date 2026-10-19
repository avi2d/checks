#!/usr/bin/env bun
import { Config, Console, Context, Effect, FileSystem, Layer, Option, Path, Schema } from "effect";
import { ChildProcessSpawner } from "effect/process";
import { DEFAULT_BRANCH } from "../core/gates.ts";
import { runMain, Usage } from "../core/main.ts";
import { gh, type GitHubFailure, gitHubJson, REPOSITORY } from "../delivery/github.ts";
import { parseReport as parseMutationReport } from "./mutation-compare.ts";
import { type Finding, findingsOf, keyOf, NightRecordSchema, type NightRecord, percent, type PreviousNight, scoresOf, type TestReport } from "./night-run-findings.ts";
import { parseReport as parseTestReport } from "./test-report.ts";

const NAME = "checks-night-run";
const USAGE = `usage: ${NAME} [--mutation <mutation-report>] [--tests <junit-report>]...`;
export const LABEL = "night-run";
const LABEL_COLOR = "5319e7";
const LABEL_DESCRIPTION = "A regression a night run on main found";
const ARTIFACT = "night-run";
const RECORD_NAME = "night-run.json";
export const RECORD = `reports/${RECORD_NAME}`;
const PAGE_SIZE = 100;
const GITHUB_TITLE_LIMIT = 256;

class NightRunFailure extends Schema.TaggedError<NightRunFailure>()("NightRunFailure", {
  message: Schema.String,
}) {}

export type Options = { readonly mutation: Option.Option<string>; readonly tests: readonly string[] };

export const parseArgs = Effect.fnUntraced(function* (argv: readonly string[]): Effect.fn.Return<Options, Usage> {
  const mutation: string[] = [];
  const tests: string[] = [];
  for (let at = 0; at < argv.length; at += 2) {
    const [flag, value] = [argv[at], argv[at + 1]];
    const into = flag === "--mutation" ? mutation : flag === "--tests" ? tests : undefined;
    if (into === undefined || value === undefined || value.startsWith("--")) return yield* new Usage({ message: USAGE });
    into.push(value);
  }
  if (mutation.length > 1 || mutation.length + tests.length === 0) return yield* new Usage({ message: USAGE });
  return { mutation: Option.fromNullishOr(mutation[0]), tests };
});

export type OpenIssue = { readonly number: number; readonly key: string };

export type Filed = { readonly key: string; readonly issue: number; readonly action: "opened" | "commented on" };

export class Issues extends Context.Service<
  Issues,
  {
    readonly ensureLabel: Effect.Effect<void, GitHubFailure>;
    readonly open: Effect.Effect<readonly OpenIssue[], GitHubFailure>;
    readonly create: (title: string, body: string) => Effect.Effect<number, GitHubFailure>;
    readonly comment: (issue: number, body: string) => Effect.Effect<void, GitHubFailure>;
  }
>()("@avi2dg/checks/testing/Issues") {
  static readonly gh = Layer.effect(
    Issues,
    Effect.gen(function* () {
      const services = yield* Effect.context<ChildProcessSpawner.ChildProcessSpawner>();
      const provided = <A>(effect: Effect.Effect<A, GitHubFailure, ChildProcessSpawner.ChildProcessSpawner>) => effect.pipe(Effect.provideContext(services));
      return Issues.of({
        ensureLabel: provided(ensureLabel),
        open: provided(openIssues),
        create: (title, body) => provided(gitHubJson(decodeNumbered, "POST", `${REPOSITORY}/issues`, { title, body, labels: [LABEL] })).pipe(Effect.map(({ number }) => number)),
        comment: (issue, body) => provided(gitHubJson(decodeAny, "POST", `${REPOSITORY}/issues/${issue}/comments`, { body })).pipe(Effect.asVoid),
      });
    }),
  );
}

const decodeNumbered = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Struct({ number: Schema.Int })));
const decodeAny = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown));
const decodeIssues = Schema.decodeUnknownEffect(
  Schema.fromJsonString(Schema.Array(Schema.Struct({ number: Schema.Int, body: Schema.NullOr(Schema.String), pull_request: Schema.optionalKey(Schema.Unknown) }))),
);
const decodeKey = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.String));

const MARKER = /<!-- checks-night-run ("(?:[^"\\]|\\.)*") -->/;

// The key is JSON with every > escaped, so no key can close the HTML comment early.
export function marker(key: string): string {
  return `<!-- checks-night-run ${JSON.stringify(key).replaceAll(">", "\\u003e")} -->`;
}

export function markedKey(body: string | null): Option.Option<string> {
  const quoted = body === null ? undefined : MARKER.exec(body)?.[1];
  return quoted === undefined ? Option.none() : decodeKey(quoted);
}

const ensureLabel = gh(["label", "create", LABEL, "--color", LABEL_COLOR, "--description", LABEL_DESCRIPTION, "--force"]).pipe(Effect.asVoid);

const openIssues = Effect.gen(function* () {
  const found: OpenIssue[] = [];
  for (let page = 1; ; page += 1) {
    const batch = yield* gitHubJson(decodeIssues, "GET", `${REPOSITORY}/issues?labels=${LABEL}&state=open&per_page=${PAGE_SIZE}&page=${page}`);
    for (const issue of batch) {
      const key = markedKey(issue.body);
      if (issue.pull_request === undefined && Option.isSome(key)) found.push({ number: issue.number, key: key.value });
    }
    if (batch.length < PAGE_SIZE) return found;
  }
});

function fullTitleOf(finding: Finding): string {
  if (finding.kind === "mutation") return `Night run: mutation score fell in ${finding.file}`;
  if (finding.kind === "test") return `Night run: ${finding.file} > ${finding.name} fails`;
  return `Night run: ${finding.file} crashed its test worker`;
}

export function titleOf(finding: Finding): string {
  const title = fullTitleOf(finding);
  return title.length <= GITHUB_TITLE_LIMIT ? title : `${title.slice(0, GITHUB_TITLE_LIMIT - 1).toWellFormed()}…`;
}

export function findingText(finding: Finding, run: string): string {
  if (finding.kind === "mutation") {
    const { file, before, after, since } = finding;
    return [
      `The night run ${run} scored \`${file}\` lower than the night run ${since}.`,
      "",
      "| File | Previous night | Tonight |",
      "| --- | --- | --- |",
      `| \`${file}\` | ${percent(before)}, ${before.detected} of ${before.valid} mutants detected | ${percent(after)}, ${after.detected} of ${after.valid} mutants detected |`,
    ].join("\n");
  }
  if (finding.kind === "test") return `The night run ${run} failed \`${finding.name}\` in \`${finding.file}\`.`;
  return `The night run ${run} lost every result of \`${finding.file}\`, because the worker running it crashed.`;
}

export function issueBody(finding: Finding, run: string): string {
  return `${findingText(finding, run)}\n\nFinding key: \`${keyOf(finding)}\`\n\n${marker(keyOf(finding))}\n`;
}

// Nothing to file means no call at all, so a quiet night never touches the label or the issues.
export const fileFindings = Effect.fn("fileFindings")(function* (findings: readonly Finding[], run: string) {
  if (findings.length === 0) return [];
  const issues = yield* Issues;
  yield* issues.ensureLabel;
  const open = new Map((yield* issues.open).map((issue) => [issue.key, issue.number]));
  const filed: Filed[] = [];
  for (const finding of findings) {
    const key = keyOf(finding);
    const known = open.get(key);
    if (known === undefined) {
      const issue = yield* issues.create(titleOf(finding), issueBody(finding, run));
      open.set(key, issue);
      filed.push({ key, issue, action: "opened" });
    } else {
      yield* issues.comment(known, findingText(finding, run));
      filed.push({ key, issue: known, action: "commented on" });
    }
  }
  return filed;
});

const required = (name: string) =>
  Config.String(name).pipe(Effect.mapError(() => new NightRunFailure({ message: `${name} is unset, so ${NAME} runs only inside a GitHub Actions job` })));

const WORKFLOW_FILE = /\/\.github\/workflows\/([^/@]+)@/;

type Actions = { readonly runs: string; readonly run: string; readonly workflow: string; readonly ref: string };

const actionsRun = Effect.gen(function* () {
  const runs = `${yield* required("GITHUB_SERVER_URL")}/${yield* required("GITHUB_REPOSITORY")}/actions/runs`;
  const reference = yield* required("GITHUB_WORKFLOW_REF");
  const workflow = WORKFLOW_FILE.exec(reference)?.[1];
  if (workflow === undefined) return yield* new NightRunFailure({ message: `GITHUB_WORKFLOW_REF ${reference} names no workflow file` });
  return { runs, run: `${runs}/${yield* required("GITHUB_RUN_ID")}`, workflow, ref: yield* required("GITHUB_REF") } satisfies Actions;
});

const decodeRuns = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Array(Schema.Struct({ databaseId: Schema.Int }))));
const decodeArtifacts = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Struct({ artifacts: Schema.Array(Schema.Struct({ name: Schema.String, expired: Schema.Boolean })) })));
const decodeRecord = Schema.decodeUnknownEffect(Schema.fromJsonString(NightRecordSchema));

const unreadable = (source: string) => (cause: { readonly message: string }) => new NightRunFailure({ message: `cannot read ${source}: ${cause.message}` });

// Only the newest successful run on main counts, so a branch dispatch never becomes the night a later run compares with.
const previousNight = Effect.fn("previousNight")(
  function* ({ runs, workflow }: Actions) {
    const listed = ["run", "list", "--workflow", workflow, "--branch", DEFAULT_BRANCH, "--status", "success", "--limit", "1", "--json", "databaseId,event,createdAt"];
    const [newest] = yield* gh(listed).pipe(Effect.flatMap(decodeRuns), Effect.mapError(unreadable(`the runs of ${workflow}`)));
    if (newest === undefined) return Option.none<PreviousNight>();
    const run = newest.databaseId;
    const { artifacts } = yield* gh(["api", `${REPOSITORY}/actions/runs/${run}/artifacts?name=${ARTIFACT}`]).pipe(
      Effect.flatMap(decodeArtifacts),
      Effect.mapError(unreadable(`the artifacts of run ${run}`)),
    );
    if (!artifacts.some((artifact) => artifact.name === ARTIFACT && !artifact.expired)) return Option.none<PreviousNight>();
    const fs = yield* FileSystem.FileSystem;
    const dir = yield* fs.makeTempDirectoryScoped({ prefix: "checks-night-run-" });
    yield* gh(["run", "download", String(run), "--name", ARTIFACT, "--dir", dir]);
    const file = (yield* Path.Path).join(dir, RECORD_NAME);
    const record = yield* fs.readFileString(file).pipe(Effect.flatMap(decodeRecord), Effect.mapError(unreadable(`the ${ARTIFACT} artifact of run ${run}`)));
    return Option.some<PreviousNight>({ url: `${runs}/${run}`, record });
  },
  Effect.scoped,
);

const readText = Effect.fn("readText")(function* (file: string) {
  return yield* (yield* FileSystem.FileSystem).readFileString(file).pipe(Effect.mapError(unreadable(file)));
});

const testReport = Effect.fn("testReport")(function* (file: string) {
  return yield* parseTestReport(yield* readText(file)).pipe(Effect.mapError(unreadable(file)));
});

const writeRecord = Effect.fn("writeRecord")(function* (record: NightRecord) {
  const fs = yield* FileSystem.FileSystem;
  yield* fs.makeDirectory((yield* Path.Path).dirname(RECORD), { recursive: true });
  yield* fs.writeFileString(RECORD, `${JSON.stringify(record, null, 2)}\n`);
});

const tonightScores = Effect.fn("tonightScores")(function* (file: string) {
  return scoresOf(yield* parseMutationReport(file, yield* readText(file)));
});

type Filing = { readonly onMain: true; readonly filed: readonly Filed[] } | { readonly onMain: false; readonly ref: string };

export function report(run: string, scored: Option.Option<number>, previous: Option.Option<PreviousNight>, findings: readonly Finding[], filing: Filing): string {
  const against = Option.isNone(scored)
    ? "had no mutation report, so it compared no score"
    : Option.isSome(previous)
      ? `compared with the night run ${previous.value.url}`
      : `found no earlier successful run on ${DEFAULT_BRANCH} holding a ${ARTIFACT} artifact, so it compared no score`;
  const verdict = findings.length === 0 ? "no finding" : `${findings.length} finding(s)`;
  const listed = filing.onMain ? filing.filed.map((one) => `  ${one.action} #${one.issue} for ${one.key}`) : findings.map((finding) => `  found ${keyOf(finding)}`);
  const recorded = !filing.onMain
    ? `${NAME}: the run is on ${filing.ref}, not ${DEFAULT_BRANCH}, so it filed no issue and recorded no score`
    : Option.isSome(scored)
      ? `${NAME}: recorded ${scored.value} file score(s) in ${RECORD}`
      : `${NAME}: recorded no score, since it had no mutation report`;
  return [`${NAME}: the night run ${run} ${against}; ${verdict}`, ...listed, recorded].join("\n");
}

const nightRun = Effect.gen(function* () {
  const options = yield* parseArgs(process.argv.slice(2));
  const actions = yield* actionsRun;
  const scores = Option.isSome(options.mutation) ? Option.some(yield* tonightScores(options.mutation.value)) : Option.none<NightRecord["scores"]>();
  const tests: TestReport[] = yield* Effect.forEach(options.tests, testReport);
  const previous = Option.isSome(scores) ? yield* previousNight(actions) : Option.none<PreviousNight>();
  const findings = findingsOf(previous, { scores: Option.getOrElse(scores, () => ({})), tests });
  const filing: Filing = actions.ref === `refs/heads/${DEFAULT_BRANCH}` ? { onMain: true, filed: yield* fileFindings(findings, actions.run) } : { onMain: false, ref: actions.ref };
  if (filing.onMain && Option.isSome(scores)) yield* writeRecord({ scores: scores.value });
  yield* Console.log(report(actions.run, Option.map(scores, (tonight) => Object.keys(tonight).length), previous, findings, filing));
  return true;
});

export function main(issues: Layer.Layer<Issues, never, ChildProcessSpawner.ChildProcessSpawner>): void {
  runMain(NAME, nightRun.pipe(Effect.provide(issues)));
}

if (import.meta.main) main(Issues.gh);
