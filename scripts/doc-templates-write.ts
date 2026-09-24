#!/usr/bin/env bun
import { Console, Effect, FileSystem, Path } from "effect";
import { KINDS, renderTemplate, TEMPLATE_DIRECTORY, TEMPLATES, templateFile } from "./doc-templates.ts";
import { runMain } from "./main.ts";

const write = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const root = path.join(import.meta.dir, "..");
  yield* fs.makeDirectory(path.join(root, TEMPLATE_DIRECTORY), { recursive: true });
  yield* Effect.forEach(KINDS, (kind) => fs.writeFileString(path.join(root, templateFile(kind)), renderTemplate(TEMPLATES[kind])));
  yield* Console.log(`doc-templates: wrote ${KINDS.length} template(s) to ${TEMPLATE_DIRECTORY}/`);
  return true;
});

if (import.meta.main) runMain("doc-templates", write);
