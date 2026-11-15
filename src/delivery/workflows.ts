#!/usr/bin/env bun
import { Console, Effect, FileSystem, Path, Schema } from "effect";
import { git } from "../core/git.ts";
import { runMain, Usage } from "../core/main.ts";
import { MANIFEST } from "../core/release-names.ts";
import { readRepository } from "./ci-wiring.ts";
import { holdsSharedWorkflow } from "./mutation-workflow.ts";
import { byHandSet, differenceLines, differencesOf, isIgnoredWorkflow, kindOf, requiredSet, type WorkflowFile } from "./workflow-set.ts";

const NAME = "workflows";
const USAGE = "usage: workflows.ts [--write]";
const WORKFLOWS = ".github/workflows";

class WorkflowsFailed extends Schema.TaggedError<WorkflowsFailed>()("WorkflowsFailed", {
  message: Schema.String,
}) {}

const decodeManifest = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Struct({ site: Schema.optionalKey(Schema.Unknown) })));

const readKind = Effect.fn("readKind")(function* (root: string) {
  const text = yield* (yield* FileSystem.FileSystem).readFileString((yield* Path.Path).join(root, MANIFEST));
  const manifest = yield* decodeManifest(text).pipe(Effect.mapError((cause) => new WorkflowsFailed({ message: `${MANIFEST}: ${cause.message}` })));
  return kindOf(manifest.site);
});

const readWorkflowFiles = Effect.fn("readWorkflowFiles")(function* (root: string) {
  const fs = yield* FileSystem.FileSystem;
  const directory = (yield* Path.Path).join(root, WORKFLOWS);
  if (!(yield* fs.exists(directory))) return [];
  const names = (yield* fs.readDirectory(directory)).filter((name) => name.endsWith(".yml") || name.endsWith(".yaml")).sort();
  return yield* Effect.forEach(names, (name) => Effect.map(fs.readFileString(`${directory}/${name}`), (text): WorkflowFile => ({ name, text })));
});

const writeSet = Effect.fn("writeSet")(function* (root: string, kind: RepositoryKind, present: readonly WorkflowFile[]) {
  const fs = yield* FileSystem.FileSystem;
  const directory = (yield* Path.Path).join(root, WORKFLOWS);
  yield* fs.makeDirectory(directory, { recursive: true });
  const held = new Set(present.map(({ name }) => name));
  const byHand = byHandSet(kind).filter(({ name }) => held.has(name));
  const written = [...requiredSet(kind), ...byHand];
  for (const { name, text } of written) yield* fs.writeFileString(`${directory}/${name}`, text);
  const kept = new Set(written.map(({ name }) => name));
  const removed = present.filter(({ name }) => !kept.has(name) && !isIgnoredWorkflow(name));
  for (const { name } of removed) yield* fs.remove(`${directory}/${name}`);
  const deleted = removed.length === 0 ? "" : `, and deleted ${removed.map(({ name }) => name).join(", ")}`;
  yield* Console.log(`${NAME}: wrote the ${written.length} workflow file(s) of the ${kind} set${deleted}`);
  return true;
});

const workflows = Effect.gen(function* () {
  const args = process.argv.slice(2);
  if (args.length > 1 || (args.length === 1 && args[0] !== "--write")) return yield* new Usage({ message: USAGE });
  const root = (yield* git(["rev-parse", "--show-toplevel"])).trim();
  if (holdsSharedWorkflow(yield* readRepository(root))) {
    yield* Console.log(`${NAME}: this repository holds the shared workflows, so it keeps its own workflow files`);
    return true;
  }
  const kind = yield* readKind(root);
  const present = yield* readWorkflowFiles(root);
  if (args[0] === "--write") return yield* writeSet(root, kind, present);
  const differences = differencesOf(kind, present);
  if (differences.length === 0) {
    yield* Console.log(`${NAME}: ${WORKFLOWS} holds the ${kind} set checks-workflows writes`);
    return true;
  }
  yield* Console.error(
    [
      `${NAME}: ${WORKFLOWS} differs from the ${kind} set in ${differences.length} file(s):`,
      ...differences.flatMap((difference) => differenceLines(WORKFLOWS, difference)),
      "  run checks-workflows --write to write the set",
    ].join("\n"),
  );
  return false;
});

if (import.meta.main) runMain(NAME, workflows);
