#!/usr/bin/env bun
import { Console, Effect, FileSystem, Path } from "effect";
import { git } from "../core/git.ts";
import { runMain, Usage } from "../core/main.ts";
import { fullActions, type RepositoryFile } from "./full-set/actions.ts";
import { countOf, heldDifferenceLines, heldDifferences, readActionFiles } from "./held-set.ts";
import { remoteCallLines, remoteCallsOf } from "./remote-calls.ts";
import { callerInputsOf, callerSetOf, parseSiteNameFlags, readWorkflowFiles, WORKFLOWS, type CallerInputs, type CallerSet, type HeldFile, type SiteNameFlags } from "./site-names.ts";
import { byHandSet, isIgnoredWorkflow, requiredSet, type WorkflowFile } from "./workflow-set.ts";

const NAME = "workflows";
const USAGE = "usage: workflows.ts [--write [--pages <project>] [--domain <domain>] [--production <owner/name>]]";
const REWRITE = "checks-workflows --write";

type Mode = { readonly write: false } | { readonly write: true; readonly flags: SiteNameFlags };

function modeOf(args: readonly string[]): Mode | undefined {
  const parsed = parseSiteNameFlags(args);
  if (parsed === undefined) return undefined;
  const flagged = Object.keys(parsed.flags).length > 0;
  const [first, ...rest] = parsed.rest;
  if (first === undefined && !flagged) return { write: false };
  return first === "--write" && rest.length === 0 ? { write: true, flags: parsed.flags } : undefined;
}

const writeActions = Effect.fn("writeActions")(function* (root: string, set: CallerSet, present: readonly RepositoryFile[]) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const written = fullActions(set);
  for (const file of written) {
    const full = path.join(root, file.path);
    yield* fs.makeDirectory(path.dirname(full), { recursive: true });
    yield* fs.writeFileString(full, file.text);
  }
  const removed = present.filter(({ path: held }) => !written.some((file) => file.path === held));
  for (const file of removed) yield* fs.remove(path.join(root, file.path));
  return { written: written.length, removed: removed.map((file) => file.path) };
});

const writeSet = Effect.fn("writeSet")(function* (root: string, set: CallerSet, present: readonly WorkflowFile[], kit: boolean) {
  const fs = yield* FileSystem.FileSystem;
  const directory = (yield* Path.Path).join(root, WORKFLOWS);
  yield* fs.makeDirectory(directory, { recursive: true });
  const held = new Set(present.map(({ name }) => name));
  const byHand = byHandSet(set).filter(({ name }) => held.has(name));
  const written = [...requiredSet(set, kit), ...byHand];
  for (const { name, text } of written) yield* fs.writeFileString(`${directory}/${name}`, text);
  const kept = new Set(written.map(({ name }) => name));
  const removed = present.filter(({ name }) => !kept.has(name) && !isIgnoredWorkflow(name, kit));
  for (const { name } of removed) yield* fs.remove(`${directory}/${name}`);
  const actions = yield* writeActions(root, set, yield* readActionFiles(root));
  const deletedNames = [...removed.map(({ name }) => name), ...actions.removed];
  const deleted = deletedNames.length === 0 ? "" : `, and deleted ${deletedNames.join(", ")}`;
  yield* Console.log(`${NAME}: wrote the ${written.length} workflow file(s) of the ${set.kind} set and its ${actions.written} action file(s)${deleted}`);
  return true;
});

const reportedSet = (present: readonly HeldFile[], flags: SiteNameFlags, inputs: CallerInputs) =>
  callerSetOf(
    present.map(({ workflow }) => workflow),
    flags,
    REWRITE,
    inputs.publishes,
    inputs.publishWorkspaces,
    inputs.needsReleaseChecks,
  );

const checkSet = Effect.fn("checkSet")(function* (root: string, set: CallerSet, present: readonly HeldFile[], kit: boolean) {
  const differences = heldDifferences(set, present, yield* readActionFiles(root), kit);
  const count = countOf(differences);
  if (count === 0) {
    yield* Console.log(`${NAME}: ${WORKFLOWS} holds the ${set.kind} set checks-workflows writes`);
    return true;
  }
  yield* Console.error(
    [`${NAME}: ${WORKFLOWS} differs from the ${set.kind} set in ${count} file(s):`, ...heldDifferenceLines(differences), `  run ${REWRITE} to write the set`].join("\n"),
  );
  return false;
});

const refuseRemoteCalls = Effect.fn("refuseRemoteCalls")(function* (present: readonly HeldFile[], kit: boolean) {
  const calls = remoteCallsOf(present.filter(({ name }) => !isIgnoredWorkflow(name, kit)).map(({ workflow }) => workflow));
  if (calls.length === 0) return true;
  yield* Console.error([`${NAME}: ${calls.length} job(s) call a workflow of another repository:`, ...remoteCallLines(calls), `  run ${REWRITE} to write the set`].join("\n"));
  return false;
});

const workflows = Effect.gen(function* () {
  const mode = modeOf(process.argv.slice(2));
  if (mode === undefined) return yield* new Usage({ message: USAGE });
  const root = (yield* git(["rev-parse", "--show-toplevel"])).trim();
  const present = yield* readWorkflowFiles(root);
  const inputs = yield* callerInputsOf(root).pipe(Effect.mapError((fault) => new Usage({ message: fault.message })));
  if (!mode.write) {
    const set = yield* reportedSet(present, {}, inputs).pipe(Effect.catchTag("CallerSetFault", (fault) => Console.error(`${NAME}: ${fault.message}`).pipe(Effect.as(undefined))));
    const local = yield* refuseRemoteCalls(present, inputs.kit);
    return set === undefined ? false : (yield* checkSet(root, set, present, inputs.kit)) && local;
  }
  const set = yield* reportedSet(present, mode.flags, inputs).pipe(Effect.mapError((fault) => new Usage({ message: fault.message })));
  return yield* writeSet(root, set, present, inputs.kit);
});

if (import.meta.main) runMain(NAME, workflows);
