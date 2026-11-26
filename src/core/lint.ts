#!/usr/bin/env bun
import { Config, Console, Effect, FileSystem, Option, Path, Schema } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { EVERY_REPOSITORY, KIT_GATES, WHOLE_TREE, WHOLE_TREE_GATES, type KitGate } from "./gates.ts";
import { changedPaths, defaultBranch, git, pathsOf } from "./git.ts";
import { runMain, Usage } from "./main.ts";
import { loadSettings } from "./settings.ts";
import { FAST_TREE_GATES, selectScope } from "./scope.ts";
import { isDeclaredGate, parseStage, stageOf, trackedFiles } from "./stage.ts";

type Range = {
  readonly refs: readonly [tip: string] | readonly [base: string, head: string];
  readonly source: string;
};

type Outcome = "passed" | "violated" | "undecided";

class RangeUnresolved extends Schema.TaggedError<RangeUnresolved>()("RangeUnresolved", {
  message: Schema.String,
}) {}

class GatesUndecided extends Schema.TaggedError<GatesUndecided>()("GatesUndecided", {
  message: Schema.String,
}) {}

const NAME = "checks-lint";
const USAGE = "usage: lint.ts [--stage source] [--full | --desk] [<base-ref> <head-ref>] | --stage built | --whole-tree";
const PULL_REQUEST_EVENT = "pull_request";
const SHALLOW_HINT = "a CI checkout needs actions/checkout fetch-depth: 0";

export const PullRequest = Schema.Struct({
  number: Schema.Int,
  title: Schema.optionalKey(Schema.String),
  base: Schema.Struct({ ref: Schema.String }),
  head: Schema.Struct({ sha: Schema.String }),
});

export const decodePullRequestEvent = Schema.decodeUnknownEffect(
  Schema.fromJsonString(Schema.Struct({ pull_request: PullRequest })),
);

// Decides the range ends an already-decoded pull request event describes.
export function pullRequestEndsOf(pullRequest: typeof PullRequest.Type): { base: string; head: string; source: string } {
  return {
    base: `origin/${pullRequest.base.ref}`,
    head: pullRequest.head.sha,
    source: `pull request #${pullRequest.number} into ${pullRequest.base.ref}`,
  };
}

const pullRequestEnds = Effect.fn("pullRequestEnds")(function* (eventPath: string) {
  const fs = yield* FileSystem.FileSystem;
  const { pull_request: pullRequest } = yield* fs.readFileString(eventPath).pipe(
    Effect.flatMap(decodePullRequestEvent),
    Effect.mapError(
      (cause) => new RangeUnresolved({ message: `cannot read the pull request from ${eventPath}: ${cause.message}` }),
    ),
  );
  return pullRequestEndsOf(pullRequest);
});

// A clone holding any remote-tracking ref but not the default branch is a shallow CI checkout,
// where judging HEAD alone would pass every commit before it unchecked. No origin ref means no remote-tracking ref at all.
export function localEndsOf(originRef: string | undefined): { base: string; head: string; source: string } {
  if (originRef === undefined) return { base: "HEAD", head: "HEAD", source: "HEAD alone, as the clone has no remote-tracking refs" };
  return { base: originRef, head: "HEAD", source: `HEAD against ${originRef}` };
}

const localEnds = Effect.gen(function* () {
  const remoteTracking = yield* git(["for-each-ref", "--count=1", "refs/remotes/"]).pipe(
    Effect.mapError((cause) => new RangeUnresolved({ message: cause.message })),
  );
  return localEndsOf(remoteTracking.trim() === "" ? undefined : `origin/${yield* defaultBranch()}`);
});

// Decides which source of range ends the arguments and the pull request env vars select,
// with no I/O: a caller resolves the selected kind against git or the event file.
export type EndsSelection =
  | { readonly kind: "explicit"; readonly base: string; readonly head: string }
  | { readonly kind: "usage" }
  | { readonly kind: "pull-request"; readonly path: string }
  | { readonly kind: "pull-request-unresolved" }
  | { readonly kind: "local" };

export function selectEnds(args: readonly string[], eventName: string | undefined, eventPath: string | undefined): EndsSelection {
  const [base, head, ...extra] = args;
  if (base !== undefined && head !== undefined && extra.length === 0) return { kind: "explicit", base, head };
  if (base !== undefined) return { kind: "usage" };
  if (eventName === PULL_REQUEST_EVENT) {
    return eventPath === undefined ? { kind: "pull-request-unresolved" } : { kind: "pull-request", path: eventPath };
  }
  return { kind: "local" };
}

const endsOf = Effect.fn("endsOf")(function* (args: readonly string[]) {
  const event = yield* Config.all({
    name: Config.option(Config.String("GITHUB_EVENT_NAME")),
    path: Config.option(Config.String("GITHUB_EVENT_PATH")),
  }).pipe(Effect.mapError((cause) => new RangeUnresolved({ message: cause.message })));
  const selection = selectEnds(
    args,
    Option.getOrUndefined(event.name),
    Option.getOrUndefined(event.path),
  );
  switch (selection.kind) {
    case "explicit":
      return { base: selection.base, head: selection.head, source: `${selection.head} against ${selection.base}` };
    case "usage":
      return yield* new Usage({ message: USAGE });
    case "pull-request":
      return yield* pullRequestEnds(selection.path);
    case "pull-request-unresolved":
      return yield* new RangeUnresolved({ message: `${PULL_REQUEST_EVENT} sets no GITHUB_EVENT_PATH` });
    case "local":
      return yield* localEnds;
  }
});

const commitOf = (ref: string) =>
  git(["rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`]).pipe(
    Effect.map((sha) => sha.trim()),
    Effect.mapError(
      (cause) => new RangeUnresolved({ message: `${ref} is not a commit in this clone; ${SHALLOW_HINT}: ${cause.message}` }),
    ),
  );

// Decides the range git merge-base already resolved: the commits between base and head, or a
// lone tip when they coincide, as every range gate would otherwise charge the head with nothing.
export function rangeOf(base: string, head: string): Range["refs"] {
  return base === head ? [head] : [base, head];
}

// From the base branch's tip, every range gate would charge the head with the commits the base
// branch gained after the head branched off.
const resolveRange = Effect.fn("resolveRange")(function* (args: readonly string[]) {
  const ends = yield* endsOf(args);
  const head = yield* commitOf(ends.head);
  const base = yield* git(["merge-base", yield* commitOf(ends.base), head]).pipe(
    Effect.map((sha) => sha.trim()),
    Effect.mapError(
      () => new RangeUnresolved({ message: `${ends.base} and ${ends.head} share no commit in this clone; ${SHALLOW_HINT}` }),
    ),
  );
  return { refs: rangeOf(base, head), source: ends.source } satisfies Range;
});

export type LintMode = "full" | "desk" | "scoped";

export function splitMode(args: readonly string[]): { readonly mode: LintMode; readonly rest: readonly string[] } | undefined {
  const flags = args.filter((arg) => arg.startsWith("--"));
  const rest = args.filter((arg) => !arg.startsWith("--"));
  if (flags.length > 1 || (flags.length === 1 && flags[0] !== "--full" && flags[0] !== "--desk")) return undefined;
  return { mode: flags.length === 0 ? "scoped" : flags[0] === "--full" ? "full" : "desk", rest };
}

export function describe({ refs }: Range): string {
  return refs.length === 1 ? `tip ${refs[0]}` : `range ${refs[0]}..${refs[1]}`;
}

function outcomeOf(exitCode: number): Outcome {
  if (exitCode === 0) return "passed";
  return exitCode === 1 ? "violated" : "undecided";
}

export function summaryOf(names: readonly string[], total: number, outcome: "failed" | "undecided"): string {
  return `${names.length} of ${total} gate(s) ${outcome}: ${names.join(", ")}`;
}

const runGate = Effect.fn("runGate")(function* (gate: KitGate, refs: readonly string[], wholeTree: boolean) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const script = (yield* Path.Path).join(import.meta.dir, "..", gate.vector, gate.file);
  const program = gate.file.endsWith(".sh") ? "sh" : process.execPath;
  const args =
    gate.reads === "range"
      ? wholeTree
        ? [script, WHOLE_TREE, ...refs]
        : [script, ...refs]
      : [script, ...(gate.args ?? [])];
  const extra = gate.env === undefined ? {} : { env: gate.env, extendEnv: true };
  const started = yield* Effect.sync(() => performance.now());
  const exitCode = yield* spawner
    .exitCode(ChildProcess.make(program, args, { stdin: "ignore", stdout: "inherit", stderr: "inherit", ...extra }))
    .pipe(
      Effect.catch((cause) =>
        Console.error(`${NAME}: cannot run ${gate.bin}: ${cause.message}`).pipe(Effect.as(ChildProcessSpawner.ExitCode(2))),
      ),
    );
  const elapsed = yield* Effect.sync(() => (performance.now() - started) / 1000);
  const outcome = outcomeOf(exitCode);
  yield* Console.log(`${NAME}: ${gate.bin} ${outcome} in ${elapsed.toFixed(2)}s`);
  return { gate, outcome };
});

const wholeTreeRange = Effect.fn("wholeTreeRange")(function* () {
  const head = yield* commitOf("HEAD");
  return { refs: [head], source: "the whole tree at HEAD" } satisfies Range;
});

const scopedGates = Effect.fn("scopedGates")(function* (range: Range, root: string) {
  if (range.refs.length === 1) return { bins: undefined, detail: "the full run, since a lone tip scopes nothing" };
  const [base, head] = range.refs;
  const changes = yield* changedPaths(base, head, [], root);
  const committed = changes.flatMap(pathsOf);
  const working = (yield* git(["diff", "--no-renames", "--name-only", "-z", "HEAD", "--"], root)).split("\0").filter(Boolean);
  const untracked = (yield* git(["ls-files", "--others", "--exclude-standard", "-z"], root)).split("\0").filter(Boolean);
  const scope = selectScope([...committed, ...working, ...untracked]);
  if (scope.full) return { bins: undefined, detail: "the full run, since the change reaches past a scoped shape" };
  return { bins: scope.gates, detail: "" };
});

const pullRequestSelection = Effect.fn("pullRequestSelection")(function* (
  split: { readonly mode: LintMode; readonly rest: readonly string[] },
  range: Range,
  root: string,
  applicable: readonly KitGate[],
) {
  if (split.mode === "desk") {
    return {
      bins: applicable.filter((gate) => FAST_TREE_GATES.includes(gate.bin)).map((gate) => gate.bin),
      detail: "the desk run",
    };
  }
  if (split.mode === "full") {
    return { bins: applicable.map((gate) => gate.bin), detail: "the full run (--full)" };
  }
  return yield* scopedGates(range, root);
});

function selectionDetail(wholeTree: boolean, mode: LintMode, scopeDetail: string, count: number): string | undefined {
  if (wholeTree) return undefined;
  if (mode === "scoped" && scopeDetail === "") return `${count} gate(s) for this change`;
  return scopeDetail === "" ? undefined : scopeDetail;
}

const tracks = (pathspecs: readonly string[], root: string) =>
  git(["ls-files", "--", ...pathspecs], root).pipe(Effect.map((files) => files.trim() !== ""));

// A tracked old file still runs the gate, so the gate fails naming the key the file moves to.
const applies = Effect.fn("applies")(function* (appliesTo: KitGate["appliesTo"], root: string) {
  if (appliesTo === EVERY_REPOSITORY) return true;
  if ("pathspecs" in appliesTo) return yield* tracks(appliesTo.pathspecs, root);
  if (Object.hasOwn(yield* loadSettings(root), appliesTo.setting)) return true;
  return yield* tracks([appliesTo.oldFile], root);
});

const judge = Effect.fn("judge")(function* (gates: readonly KitGate[], refs: readonly string[], wholeTree: boolean) {
  const verdicts = yield* Effect.forEach(gates, (gate) => runGate(gate, refs, wholeTree));
  const failed = verdicts.filter((verdict) => verdict.outcome !== "passed");
  if (failed.length === 0) {
    yield* Console.log(`${NAME}: ${gates.length} gate(s) pass`);
    return true;
  }
  const names = failed.map((verdict) => verdict.gate.bin);
  if (failed.every((verdict) => verdict.outcome === "undecided")) {
    return yield* new GatesUndecided({ message: summaryOf(names, gates.length, "undecided") });
  }
  const summary = summaryOf(names, gates.length, "failed");
  yield* Console.error(`${NAME}: ${summary}`);
  return false;
});

const builtGatesOf = Effect.fn("builtGatesOf")(function* (gates: readonly KitGate[], root: string) {
  const tracked = gates.some(isDeclaredGate) ? yield* trackedFiles(root) : [];
  return yield* Effect.filter(gates, (gate) => stageOf(gate, root, tracked).pipe(Effect.map((stage) => stage === "built")));
});

const sourceStage = Effect.fn("sourceStage")(function* (gates: readonly KitGate[], root: string) {
  const built = yield* builtGatesOf(gates, root);
  if (built.length > 0) yield* Console.log(`${NAME}: the source stage leaves ${built.map((gate) => gate.bin).join(", ")} to the built stage`);
  return gates.filter((gate) => !built.includes(gate));
});

// Every gate of the built stage reads the working tree, so the stage resolves no range and a shallow checkout serves it.
const builtStage = Effect.fn("builtStage")(function* (args: readonly string[]) {
  if (args.length > 0) return yield* new Usage({ message: USAGE });
  const root = (yield* git(["rev-parse", "--show-toplevel"])).trim();
  yield* Console.log(`${NAME}: the built stage judges the working tree`);
  const applicable = yield* Effect.filter(KIT_GATES.filter(isDeclaredGate), (gate) => applies(gate.appliesTo, root));
  return yield* judge(yield* builtGatesOf(applicable, root), [], false);
});

const lint = Effect.gen(function* () {
  const staged = parseStage(process.argv.slice(2));
  if (staged === undefined) return yield* new Usage({ message: USAGE });
  if (staged.stage === "built") return yield* builtStage(staged.rest);
  const raw = staged.rest;
  const wholeTree = raw.includes(WHOLE_TREE);
  if (wholeTree && (raw.length > 1 || staged.stage !== undefined)) return yield* new Usage({ message: USAGE });
  const split = wholeTree ? { mode: "full" as const, rest: [] as readonly string[] } : splitMode(raw);
  if (split === undefined) return yield* new Usage({ message: USAGE });
  const root = (yield* git(["rev-parse", "--show-toplevel"])).trim();
  const range = wholeTree ? yield* wholeTreeRange() : yield* resolveRange(split.rest);
  yield* Console.log(`${NAME}: ${describe(range)} from ${range.source}`);
  const applicable = yield* Effect.filter(wholeTree ? WHOLE_TREE_GATES : KIT_GATES, (gate) => applies(gate.appliesTo, root));
  const scoped = wholeTree
    ? { bins: applicable.map((gate) => gate.bin) as readonly string[] | undefined, detail: "" }
    : yield* pullRequestSelection(split, range, root, applicable);
  const bins = scoped.bins;
  const selected = bins === undefined ? applicable : applicable.filter((gate) => bins.includes(gate.bin));
  const detail = selectionDetail(wholeTree, split.mode, scoped.detail, selected.length);
  if (detail !== undefined) yield* Console.log(`${NAME}: ${detail}`);
  const gates = staged.stage === "source" ? yield* sourceStage(selected, root) : selected;
  return yield* judge(gates, range.refs, wholeTree);
});

if (import.meta.main) runMain(NAME, lint);
