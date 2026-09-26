#!/usr/bin/env bun
import { Effect, FileSystem, Schema } from "effect";
import { runMain, Usage } from "./main.ts";

export class ReleaseSectionUnavailable extends Schema.TaggedError<ReleaseSectionUnavailable>()("ReleaseSectionUnavailable", {
  message: Schema.String,
}) {}

export function extractReleaseNotes(changelog: string, version: string): Effect.Effect<string, ReleaseSectionUnavailable> {
  const lines = changelog.split(/\r?\n/);
  const heading = lines.indexOf(`## ${version}`);
  if (heading === -1) return Effect.fail(new ReleaseSectionUnavailable({ message: `CHANGELOG.md has no section for ${version}` }));

  const next = lines.findIndex((line, index) => index > heading && line.startsWith("## "));
  const body = lines.slice(heading + 1, next === -1 ? lines.length : next);
  let start = 0;
  let end = body.length;
  while (start < end && body[start]?.trim() === "") start += 1;
  while (end > start && body[end - 1]?.trim() === "") end -= 1;
  const notes = body.slice(start, end).join("\n");
  return notes === ""
    ? Effect.fail(new ReleaseSectionUnavailable({ message: `CHANGELOG.md has an empty section for ${version}` }))
    : Effect.succeed(notes);
}

const releaseNotes = Effect.gen(function* () {
  const [version, output] = process.argv.slice(2);
  if (version === undefined || output === undefined) return yield* new Usage({ message: "usage: release-notes.ts <version> <output>" });
  const fs = yield* FileSystem.FileSystem;
  const notes = yield* extractReleaseNotes(yield* fs.readFileString("CHANGELOG.md"), version);
  yield* fs.writeFileString(output, notes);
  return true;
});

if (import.meta.main) runMain("release-notes", releaseNotes);
