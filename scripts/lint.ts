#!/usr/bin/env bun
import { Config, Console, Effect, FileSystem, Option, Path, Schema } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import { DEFAULT_BRANCH, KIT_GATES, type KitGate } from "./gates.ts";
import { git } from "./git.ts";
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

const decodePullRequestEvent = Schema.decodeUnknownEffect(
  Schema.fromJsonString(
    Schema.Struct({
      pull_request: Schema.Struct({
        number: Schema.Int,
        base: Schema.Struct({ ref: Schema.String }),
        head: Schema.Struct({ sha: Schema.String }),
      }),
    }),
  ),
);

const pullRequestEnds = Effect.fn("pullRequestEnds")(function* (eventPath: string) {
  const fs = yield* FileSystem.FileSystem;
  const { pull_request: pullRequest } = yield* fs.readFileString(eventPath).pipe(
    Effect.flatMap(decodePullRequestEvent),
    Effect.mapError(
      (cause) => new RangeUnresolved({ message: `cannot read the pull request from ${eventPath}: ${cause.message}` }),
    ),
  );
  return {
    base: `origin/${pullRequest.base.ref}`,
    head: pullRequest.head.sha,
    source: `pull request #${pullRequest.number} into ${pullRequest.base.ref}`,
  };
});

const decodeManifest = Schema.decodeUnknownEffect(
  Schema.fromJsonString(
    Schema.Struct({
      ciWiring: Schema.optionalKey(Schema.Struct({ defaultBranch: Schema.optionalKey(Schema.NonEmptyString) })),
    }),
  ),
);

const declaredDefaultBranch = Effect.gen(function* () {
  const root = (yield* git(["rev-parse", "--show-toplevel"])).trim();
  const manifest = (yield* Path.Path).join(root, "package.json");
  const { ciWiring } = yield* (yield* FileSystem.FileSystem).readFileString(manifest).pipe(Effect.flatMap(decodeManifest));
  return ciWiring?.defaultBranch ?? DEFAULT_BRANCH;
}).pipe(
  Effect.mapError((cause) => new RangeUnresolved({ message: `cannot read ciWiring.defaultBranch: ${cause.message}` })),
);

const originEnds = git(["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"]).pipe(
  Effect.map((ref) => ref.trim()),
  Effect.catchTag("GitFailure", () => declaredDefaultBranch.pipe(Effect.map((branch) => `origin/${branch}`))),
  Effect.map((base) => ({ base, head: "HEAD", source: `HEAD against ${base}` })),
);

// A clone holding any remote-tracking ref but not the default branch is a shallow CI checkout,
// where judging HEAD alone would pass every commit before it unchecked.
const localEnds = Effect.gen(function* () {
  const remoteTracking = yield* git(["for-each-ref", "--count=1", "refs/remotes/"]).pipe(
    Effect.mapError((cause) => new RangeUnresolved({ message: cause.message })),
  );
  if (remoteTracking.trim() === "") {
    return { base: "HEAD", head: "HEAD", source: "HEAD alone, as the clone has no remote-tracking refs" };
  }
  return yield* originEnds;
});

const endsOf = Effect.fn("endsOf")(function* (args: readonly string[]) {
  const [base, head, ...extra] = args;
  if (base !== undefined && head !== undefined && extra.length === 0) {
    return { base, head, source: `${head} against ${base}` };
  }
  if (base !== undefined) return yield* new Usage({ message: USAGE });

  const event = yield* Config.all({
    name: Config.option(Config.String("GITHUB_EVENT_NAME")),
    path: Config.option(Config.String("GITHUB_EVENT_PATH")),
  }).pipe(Effect.mapError((cause) => new RangeUnresolved({ message: cause.message })));
  if (Option.isSome(event.name) && event.name.value === PULL_REQUEST_EVENT) {
    if (Option.isNone(event.path)) {
      return yield* new RangeUnresolved({ message: `${PULL_REQUEST_EVENT} sets no GITHUB_EVENT_PATH` });
    }
    return yield* pullRequestEnds(event.path.value);
  }
  return yield* localEnds;
});

const commitOf = (ref: string) =>
  git(["rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`]).pipe(
    Effect.map((sha) => sha.trim()),
    Effect.mapError(
      (cause) => new RangeUnresolved({ message: `${ref} is not a commit in this clone; ${SHALLOW_HINT}: ${cause.message}` }),
    ),
  );

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
  return { refs: base === head ? [head] : [base, head], source: ends.source } satisfies Range;
});

function describe({ refs }: Range): string {
  return refs.length === 1 ? `tip ${refs[0]}` : `range ${refs[0]}..${refs[1]}`;
}

function outcomeOf(exitCode: number): Outcome {
  if (exitCode === 0) return "passed";
  return exitCode === 1 ? "violated" : "undecided";
}

const runGate = Effect.fn("runGate")(function* (gate: KitGate, range: Range) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const script = (yield* Path.Path).join(import.meta.dir, gate.script);
  const program = gate.script.endsWith(".sh") ? "sh" : process.execPath;
  const args = gate.reads === "range" ? [script, ...range.refs] : [script];
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
  const range = yield* resolveRange(process.argv.slice(2));
  yield* Console.log(`${NAME}: ${describe(range)} from ${range.source}`);

  const verdicts = yield* Effect.forEach(KIT_GATES, (gate) => runGate(gate, range));
  const failed = verdicts.filter((verdict) => verdict.outcome !== "passed");
  if (failed.length === 0) {
    yield* Console.log(`${NAME}: ${KIT_GATES.length} gate(s) pass`);
    return true;
  }
  const summary = `${failed.length} of ${KIT_GATES.length} gate(s) failed: ${failed.map((verdict) => verdict.gate.bin).join(", ")}`;
  if (failed.every((verdict) => verdict.outcome === "undecided")) {
    return yield* new GatesUndecided({ message: summary });
  }
  yield* Console.error(`${NAME}: ${summary}`);
  return false;
});

if (import.meta.main) runMain(NAME, lint);
