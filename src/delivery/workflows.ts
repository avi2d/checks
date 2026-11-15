#!/usr/bin/env bun
import { Console, Effect, FileSystem, Path } from "effect";
import { git } from "../core/git.ts";
import { runMain, Usage } from "../core/main.ts";
import { readRepository } from "./ci-wiring.ts";
import { holdsSharedWorkflow } from "./mutation-workflow.ts";
import { callerSetOf, parseSiteNameFlags, readWorkflowFiles, WORKFLOWS, type CallerSet, type HeldFile, type SiteNameFlags } from "./site-names.ts";
import { byHandSet, differenceLines, differencesOf, holdsSingleJobCi, isIgnoredWorkflow, requiredSet, type WorkflowFile } from "./workflow-set.ts";

const NAME = "workflows";
const USAGE = "usage: workflows.ts [--write [--pages <project>] [--domain <domain>] [--production <owner/name>]]";
const REWRITE = "checks-workflows --write";

type Mode = { readonly write: false } | { readonly write: true; readonly flags: SiteNameFlags };

function modeOf(args: readonly string[]): Mode | undefined {
  const parsed = parseSiteNameFlags(args);
  if (parsed === undefined) return undefined;
  const flagged = Object.keys(parsed.flags).length > 0;
  if (parsed.rest.length === 0 && !flagged) return { write: false };
  if (parsed.rest.length === 1 && parsed.rest[0] === "--write") return { write: true, flags: parsed.flags };
  return undefined;
}

const writeSet = Effect.fn("writeSet")(function* (root: string, set: CallerSet, present: readonly WorkflowFile[]) {
  const fs = yield* FileSystem.FileSystem;
  const directory = (yield* Path.Path).join(root, WORKFLOWS);
  yield* fs.makeDirectory(directory, { recursive: true });
  const held = new Set(present.map(({ name }) => name));
  const byHand = byHandSet(set.kind).filter(({ name }) => held.has(name));
  const written = [...requiredSet(set), ...byHand];
  for (const { name, text } of written) yield* fs.writeFileString(`${directory}/${name}`, text);
  const kept = new Set(written.map(({ name }) => name));
  const removed = present.filter(({ name }) => !kept.has(name) && !isIgnoredWorkflow(name));
  for (const { name } of removed) yield* fs.remove(`${directory}/${name}`);
  const deleted = removed.length === 0 ? "" : `, and deleted ${removed.map(({ name }) => name).join(", ")}`;
  yield* Console.log(`${NAME}: wrote the ${written.length} workflow file(s) of the ${set.kind} set${deleted}`);
  return true;
});

const checkSet = Effect.fn("checkSet")(function* (present: readonly HeldFile[]) {
  const set = yield* callerSetOf(
    present.map(({ workflow }) => workflow),
    {},
    REWRITE,
  ).pipe(Effect.catchTag("CallerSetFault", (fault) => Console.error(`${NAME}: ${fault.message}`).pipe(Effect.as(undefined))));
  if (set === undefined) return false;
  const differences = differencesOf(set, present);
  if (differences.length === 0) {
    yield* Console.log(`${NAME}: ${WORKFLOWS} holds the ${set.kind} set checks-workflows writes`);
    if (holdsSingleJobCi(set, present)) {
      yield* Console.log(`${NAME}: ${WORKFLOWS}/ci.yml is the single-job caller, so run ${REWRITE} to write the composed ci.yml`);
    }
    return true;
  }
  yield* Console.error(
    [
      `${NAME}: ${WORKFLOWS} differs from the ${set.kind} set in ${differences.length} file(s):`,
      ...differences.flatMap((difference) => differenceLines(WORKFLOWS, difference)),
      `  run ${REWRITE} to write the set`,
    ].join("\n"),
  );
  return false;
});

const workflows = Effect.gen(function* () {
  const mode = modeOf(process.argv.slice(2));
  if (mode === undefined) return yield* new Usage({ message: USAGE });
  const root = (yield* git(["rev-parse", "--show-toplevel"])).trim();
  if (holdsSharedWorkflow(yield* readRepository(root))) {
    yield* Console.log(`${NAME}: this repository holds the shared workflows, so it keeps its own workflow files`);
    return true;
  }
  const present = yield* readWorkflowFiles(root);
  if (!mode.write) return yield* checkSet(present);
  const set = yield* callerSetOf(
    present.map(({ workflow }) => workflow),
    mode.flags,
    REWRITE,
  ).pipe(Effect.mapError((fault) => new Usage({ message: fault.message })));
  return yield* writeSet(root, set, present);
});

if (import.meta.main) runMain(NAME, workflows);
