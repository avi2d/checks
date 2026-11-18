#!/usr/bin/env bun
import { Console, Effect, FileSystem, Path } from "effect";
import { git } from "../core/git.ts";
import { runMain, Usage } from "../core/main.ts";
import { readRepository } from "./ci-wiring.ts";
import { fullActions, type RepositoryFile } from "./full-set/actions.ts";
import { countOf, heldDifferenceLines, heldDifferences, layoutOf, readActionFiles } from "./held-set.ts";
import { holdsSharedWorkflow } from "./mutation-workflow.ts";
import { callerInputsOf, callerSetOf, parseSiteNameFlags, readWorkflowFiles, WORKFLOWS, type CallerInputs, type CallerSet, type HeldFile, type SiteNameFlags } from "./site-names.ts";
import { byHandSet, fullRefusal, holdsSingleJobCi, isIgnoredWorkflow, requiredSet, type Layout, type WorkflowFile } from "./workflow-set.ts";

const NAME = "workflows";
const USAGE = "usage: workflows.ts [--write [--full] [--pages <project>] [--domain <domain>] [--production <owner/name>]]";
const REWRITE = "checks-workflows --write";

type Mode = { readonly write: false } | { readonly write: true; readonly full: boolean; readonly flags: SiteNameFlags };

function modeOf(args: readonly string[]): Mode | undefined {
  const parsed = parseSiteNameFlags(args);
  if (parsed === undefined) return undefined;
  const flagged = Object.keys(parsed.flags).length > 0;
  const [first, second, ...rest] = parsed.rest;
  if (first === undefined && !flagged) return { write: false };
  if (first !== "--write" || rest.length > 0) return undefined;
  if (second === undefined) return { write: true, full: false, flags: parsed.flags };
  return second === "--full" ? { write: true, full: true, flags: parsed.flags } : undefined;
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

const writeSet = Effect.fn("writeSet")(function* (root: string, set: CallerSet, present: readonly WorkflowFile[], layout: Layout) {
  const fs = yield* FileSystem.FileSystem;
  const directory = (yield* Path.Path).join(root, WORKFLOWS);
  yield* fs.makeDirectory(directory, { recursive: true });
  const held = new Set(present.map(({ name }) => name));
  const byHand = byHandSet(set, layout).filter(({ name }) => held.has(name));
  const written = [...requiredSet(set, layout), ...byHand];
  for (const { name, text } of written) yield* fs.writeFileString(`${directory}/${name}`, text);
  const kept = new Set(written.map(({ name }) => name));
  const removed = present.filter(({ name }) => !kept.has(name) && !isIgnoredWorkflow(name, layout));
  for (const { name } of removed) yield* fs.remove(`${directory}/${name}`);
  const actions = layout.full ? yield* writeActions(root, set, yield* readActionFiles(root)) : { written: 0, removed: [] };
  const deletedNames = [...removed.map(({ name }) => name), ...actions.removed];
  const deleted = deletedNames.length === 0 ? "" : `, and deleted ${deletedNames.join(", ")}`;
  const actionNote = layout.full ? ` and its ${actions.written} action file(s)` : "";
  yield* Console.log(`${NAME}: wrote the ${written.length} workflow file(s) of the ${set.kind} set${actionNote}${deleted}`);
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

const checkSet = Effect.fn("checkSet")(function* (root: string, set: CallerSet, present: readonly HeldFile[], layout: Layout) {
  const refusal = layout.full ? fullRefusal(set) : undefined;
  if (refusal !== undefined) {
    yield* Console.error(`${NAME}: ${refusal}`);
    return false;
  }
  const differences = heldDifferences(set, present, yield* readActionFiles(root), layout);
  const count = countOf(differences);
  const rewrite = layout.full ? `${REWRITE} --full` : REWRITE;
  if (count === 0) {
    yield* Console.log(`${NAME}: ${WORKFLOWS} holds the ${layout.full ? "full " : ""}${set.kind} set checks-workflows writes`);
    if (!layout.full && holdsSingleJobCi(set, present)) {
      yield* Console.log(`${NAME}: ${WORKFLOWS}/ci.yml is the single-job caller, so run ${REWRITE} to write the composed ci.yml`);
    }
    return true;
  }
  yield* Console.error(
    [`${NAME}: ${WORKFLOWS} differs from the ${layout.full ? "full " : ""}${set.kind} set in ${count} file(s):`, ...heldDifferenceLines(differences, layout), `  run ${rewrite} to write the set`].join("\n"),
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
  const inputs = yield* callerInputsOf(root).pipe(Effect.mapError((fault) => new Usage({ message: fault.message })));
  const layout = yield* layoutOf(root, inputs.kit, mode.write && mode.full);
  if (!mode.write) {
    const set = yield* reportedSet(present, {}, inputs).pipe(Effect.catchTag("CallerSetFault", (fault) => Console.error(`${NAME}: ${fault.message}`).pipe(Effect.as(undefined))));
    return set === undefined ? false : yield* checkSet(root, set, present, layout);
  }
  const set = yield* reportedSet(present, mode.flags, inputs).pipe(Effect.mapError((fault) => new Usage({ message: fault.message })));
  const refusal = layout.full ? fullRefusal(set) : undefined;
  if (refusal !== undefined) return yield* new Usage({ message: refusal });
  return yield* writeSet(root, set, present, layout);
});

if (import.meta.main) runMain(NAME, workflows);
