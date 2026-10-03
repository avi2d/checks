#!/usr/bin/env bun
import { Config, Console, Effect, FileSystem, Option, Path, Schema } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { EVERY_REPOSITORY, KIT_GATES, type KitGate } from "./gates.ts";
import { defaultBranch, git } from "./git.ts";
import { runMain, Usage } from "./main.ts";

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
const USAGE = "usage: lint.ts [<base-ref> <head-ref>]";
const PULL_REQUEST_EVENT = "pull_request";
const SHALLOW_HINT = "a CI checkout needs actions/checkout fetch-depth: 0";

const PullRequest = Schema.Struct({
  number: Schema.Int,
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

export function describe({ refs }: Range): string {
  return refs.length === 1 ? `tip ${refs[0]}` : `range ${refs[0]}..${refs[1]}`;
}

function outcomeOf(exitCode: number): Outcome {
  if (exitCode === 0) return "passed";
  return exitCode === 1 ? "violated" : "undecided";
}

const runGate = Effect.fn("runGate")(function* (gate: KitGate, range: Range) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const script = (yield* Path.Path).join(import.meta.dir, "..", gate.vector, gate.file);
  const program = gate.file.endsWith(".sh") ? "sh" : process.execPath;
  const args = gate.reads === "range" ? [script, ...range.refs] : [script, ...(gate.args ?? [])];
  const exitCode = yield* spawner
    .exitCode(ChildProcess.make(program, args, { stdin: "ignore", stdout: "inherit", stderr: "inherit" }))
    .pipe(
      Effect.catch((cause) =>
        Console.error(`${NAME}: cannot run ${gate.bin}: ${cause.message}`).pipe(Effect.as(ChildProcessSpawner.ExitCode(2))),
      ),
    );
  return { gate, outcome: outcomeOf(exitCode) };
});

const lint = Effect.gen(function* () {
  const root = (yield* git(["rev-parse", "--show-toplevel"])).trim();
  const range = yield* resolveRange(process.argv.slice(2));
  yield* Console.log(`${NAME}: ${describe(range)} from ${range.source}`);
  const gates = yield* Effect.filter(KIT_GATES, (gate) =>
    gate.appliesTo === EVERY_REPOSITORY
      ? Effect.succeed(true)
      : git(["ls-files", "--", ...gate.appliesTo.pathspecs], root).pipe(Effect.map((files) => files.trim() !== "")),
  );
  const verdicts = yield* Effect.forEach(gates, (gate) => runGate(gate, range));
  const failed = verdicts.filter((verdict) => verdict.outcome !== "passed");
  if (failed.length === 0) {
    yield* Console.log(`${NAME}: ${gates.length} gate(s) pass`);
    return true;
  }
  const summary = `${failed.length} of ${gates.length} gate(s) failed: ${failed.map((verdict) => verdict.gate.bin).join(", ")}`;
  if (failed.every((verdict) => verdict.outcome === "undecided")) {
    return yield* new GatesUndecided({ message: summary });
  }
  yield* Console.error(`${NAME}: ${summary}`);
  return false;
});

if (import.meta.main) runMain(NAME, lint);
