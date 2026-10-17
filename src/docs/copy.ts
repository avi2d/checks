#!/usr/bin/env bun
import { Effect, FileSystem, Path, Schema } from "effect";
import { emptyInputs, inputsReport, runDeclaredGate, violationLine, type Declared, type Input, type Violation } from "../core/declared-inputs.ts";
import { Usage } from "../core/main.ts";
import { markdownFindings } from "./copy-text.ts";

const DECLARED: Declared = { name: "copy", file: "copy.json", declares: "copy" };

const MARKDOWN = ".md";
const HTML = ".html";

const OUTSIDE = /(?:^|\/)node_modules\//;

export type Scan = {
  readonly inputs: readonly Input[];
  readonly unread: readonly string[];
  readonly violations: readonly Violation[];
};

class CopyError extends Schema.TaggedError<CopyError>()("CopyError", {
  message: Schema.String,
}) {}

function isCopyFile(file: string): boolean {
  return file.endsWith(MARKDOWN) || file.endsWith(HTML);
}

const matched = (root: string, glob: string) =>
  Effect.tryPromise({
    try: () => Array.fromAsync(new Bun.Glob(glob).scan({ cwd: root, onlyFiles: true })),
    catch: (cause) => new CopyError({ message: `cannot expand ${glob}: ${String(cause)}` }),
  }).pipe(Effect.map((files) => files.filter((file) => !OUTSIDE.test(file)).toSorted()));

const loadHtml = Effect.tryPromise({
  try: () => import("./copy-html.ts"),
  catch: () => new Usage({ message: `cannot load html-validate, which a repository that declares HTML in ${DECLARED.file} installs beside the kit as an optional peer` }),
});

const judge = Effect.fn("judge")(function* (root: string, file: string) {
  const source = yield* (yield* FileSystem.FileSystem).readFileString((yield* Path.Path).join(root, file));
  const findings = file.endsWith(HTML) ? yield* (yield* loadHtml).htmlFindings(source, file) : markdownFindings(source);
  return findings.map(({ line, column, message }) => ({ file, line, column, text: message }) satisfies Violation);
});

export const scanInputs = Effect.fn("scanInputs")(function* (root: string, globs: readonly string[]) {
  const inputs: Input[] = [];
  const unread = new Set<string>();
  for (const glob of globs) {
    const files = yield* matched(root, glob);
    inputs.push({ glob, files: files.filter(isCopyFile) });
    for (const other of files.filter((file) => !isCopyFile(file))) unread.add(other);
  }
  const judged = [...new Set(inputs.flatMap(({ files }) => files))].toSorted();
  const violations = yield* Effect.forEach(judged, (file) => judge(root, file));
  return { inputs, unread: [...unread].toSorted(), violations: violations.flat() } satisfies Scan;
});

export function passes({ inputs, unread, violations }: Scan): boolean {
  return violations.length === 0 && unread.length === 0 && emptyInputs(inputs).length === 0;
}

export function report({ inputs, unread, violations }: Scan): string {
  return inputsReport(DECLARED.name, inputs, [
    ...emptyInputs(inputs).map(({ glob }) => `${glob}: the declared input matches no Markdown or HTML file`),
    ...unread.map((file) => `${file}: is neither Markdown nor HTML, so the gate cannot read it`),
    ...violations.map(violationLine),
  ]);
}

if (import.meta.main) runDeclaredGate(DECLARED, scanInputs, { report, passes });
