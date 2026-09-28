#!/usr/bin/env bun
import { Clock, Config, Console, Effect, FileSystem, type Layer, Option, Path, Schema } from "effect";
import { changedPaths, commitOf, git, pathsAt, rangeFromArgs, writtenAt } from "../core/git.ts";
import type { BunServices } from "@effect/platform-bun";
import { runMain, Usage } from "../core/main.ts";
import {
  ACKNOWLEDGEMENTS,
  clockOf,
  decodeAcknowledgements,
  decodeOsvReport,
  findingsIn,
  judge,
  LOCKFILE,
  passes,
  report,
  summaryOf,
  type AcknowledgementClock,
  type Outcome,
} from "./advisory-rules.ts";
import { cacheRoot } from "./cache-root.ts";
import { scanLockfiles, Scanner } from "./osv-scanner.ts";

const NAME = "advisories";
const ALL = "--all";
const USAGE = `usage: advisories.ts <ref> | <base-ref> <head-ref> | ${ALL}`;
const SIDES = ["base", "head"] as const;

class AdvisoriesError extends Schema.TaggedError<AdvisoriesError>()("AdvisoriesError", {
  message: Schema.String,
}) {}

type Request = { readonly kind: "range"; readonly base: string; readonly head: string } | { readonly kind: "head"; readonly head: string };

const requestOf = Effect.fn("requestOf")(function* (args: readonly string[]) {
  if (args[0] === ALL) {
    if (args.length > 1) return yield* new Usage({ message: USAGE });
    return { kind: "head", head: yield* commitOf("HEAD") } satisfies Request;
  }
  const { base, head } = yield* rangeFromArgs(args, USAGE);
  return { kind: "range", base, head: yield* commitOf(head) } satisfies Request;
});

const fileAt = Effect.fn("fileAt")(function* (rev: string, file: string, root: string) {
  if (!(yield* pathsAt(rev, [file], root)).includes(file)) return Option.none<string>();
  return Option.some(yield* git(["show", `${rev}:${file}`], root));
});

const acknowledgementsAt = Effect.fn("acknowledgementsAt")(function* (head: string, root: string) {
  const text = yield* fileAt(head, ACKNOWLEDGEMENTS, root);
  if (Option.isNone(text)) return [];
  return yield* decodeAcknowledgements(text.value).pipe(
    Effect.mapError((cause) => new AdvisoriesError({ message: `${ACKNOWLEDGEMENTS} at ${head} does not decode: ${cause.message}` })),
  );
});

type Lockfiles = Readonly<Record<(typeof SIDES)[number], Option.Option<string>>>;

// Scanning copies keeps the working tree and a repository's own osv-scanner.toml out of the verdict.
const findingsOf = Effect.fn("findingsOf")(function* (lockfiles: Lockfiles) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const dir = yield* fs.makeTempDirectoryScoped({ prefix: "checks-advisories-" });
  const config = path.join(dir, "empty.toml");
  yield* fs.writeFileString(config, "");
  const written: string[] = [];
  for (const side of SIDES) {
    const text = lockfiles[side];
    if (Option.isNone(text)) continue;
    yield* fs.makeDirectory(path.join(dir, side));
    yield* fs.writeFileString(path.join(dir, side, LOCKFILE), text.value);
    written.push(path.join(dir, side, LOCKFILE));
  }
  const cache = yield* cacheRoot();
  const { stdout, note } = yield* scanLockfiles(yield* (yield* Scanner).binary(cache), cache, config, written);
  if (Option.isSome(note)) yield* Console.error(`${NAME}: ${note.value}`);
  const scanned = yield* decodeOsvReport(stdout).pipe(
    Effect.mapError((cause) => new AdvisoriesError({ message: `cannot read the report OSV-Scanner wrote: ${cause.message}` })),
  );
  const at = (side: string) => (source: string) => source.endsWith(`${path.sep}${side}${path.sep}${LOCKFILE}`);
  return { base: findingsIn(scanned, at("base")), head: findingsIn(scanned, at("head")) };
}, Effect.scoped);

const outcomeOf = Effect.fn("outcomeOf")(function* (request: Request, root: string, clock: AcknowledgementClock) {
  if (request.kind === "range" && (yield* changedPaths(request.base, request.head, [LOCKFILE], root)).length === 0) {
    return { kind: "unchanged", problems: clock.problems } satisfies Outcome;
  }
  const head = yield* fileAt(request.head, LOCKFILE, root);
  const base = request.kind === "range" ? yield* fileAt(request.base, LOCKFILE, root) : Option.none<string>();
  const findings = Option.isNone(head) ? { base: [], head: [] } : yield* findingsOf({ base, head });
  return { kind: "scanned", scope: { kind: request.kind }, judged: judge(findings.base, findings.head, clock) } satisfies Outcome;
});

const toStepSummary = Effect.fn("toStepSummary")(function* (text: string) {
  const stepSummary = yield* Config.option(Config.String("GITHUB_STEP_SUMMARY"));
  if (Option.isNone(stepSummary)) return;
  yield* (yield* FileSystem.FileSystem).writeFileString(stepSummary.value, `${summaryOf(text)}\n`, { flag: "a" });
});

const advisories = Effect.gen(function* () {
  const request = yield* requestOf(process.argv.slice(2));
  const root = (yield* git(["rev-parse", "--show-toplevel"])).trim();
  const dates = { head: (yield* writtenAt(request.head, root)) * 1000, now: yield* Clock.currentTimeMillis };
  const clock = clockOf(yield* acknowledgementsAt(request.head, root), { kind: request.kind }, dates);
  const outcome = yield* outcomeOf(request, root, clock);
  const text = report(outcome);
  yield* Console.log(text);
  if (request.kind === "head") yield* toStepSummary(text);
  return passes(outcome);
});

export function main(scanner: Layer.Layer<Scanner, never, BunServices.BunServices>): void {
  runMain(NAME, advisories.pipe(Effect.provide(scanner)));
}

if (import.meta.main) main(Scanner.pinned);
