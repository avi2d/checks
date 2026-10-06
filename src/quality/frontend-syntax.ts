#!/usr/bin/env bun
import { Console, Effect, FileSystem, Path, Schema } from "effect";
import type { LintResult } from "stylelint";
import { runMain, Usage } from "../core/main.ts";

const NAME = "frontend-syntax";

const DECLARATION = "frontend-syntax.json";

const TRANSITION_ALL = "declaration-property-value-disallowed-list";
const BODY_WIDE_USER_SELECT = "rule-selector-property-disallowed-list";
const UNPARSED = "CssSyntaxError";

const RULES = {
  [TRANSITION_ALL]: [{ "/^(?:-[a-z]+-)?transition(?:-property)?$/": ["/(?:^|[\\s,])all(?:[\\s,]|$)/i"] }],
  [BODY_WIDE_USER_SELECT]: [{ "/(?:^|,)\\s*(?:html|body|:root|\\*|:global\\(\\s*(?:html|body|:root|\\*)\\s*\\))\\s*(?:,|$)/": ["/^(?:-[a-z]+-)?user-select$/"] }],
} as const;

const ADVICE: Readonly<Record<string, string>> = {
  [TRANSITION_ALL]: "Name the properties the transition animates.",
  [BODY_WIDE_USER_SELECT]: "Leave text selectable across the page, and turn selection off only on the control that needs it.",
  [UNPARSED]: "The gate judges only what parses.",
};

const MARKUP = ["**/*.html", "**/*.astro", "**/*.vue", "**/*.svelte"];

const Declaration = Schema.Struct({ inputs: Schema.NonEmptyArray(Schema.NonEmptyString) });

const decodeDeclaration = Schema.decodeUnknownEffect(Schema.fromJsonString(Declaration));

export type Violation = {
  readonly file: string;
  readonly line: number;
  readonly column: number;
  readonly text: string;
};

export type Input = {
  readonly glob: string;
  readonly files: readonly string[];
};

export type Scan = {
  readonly inputs: readonly Input[];
  readonly violations: readonly Violation[];
};

class FrontendSyntaxError extends Schema.TaggedError<FrontendSyntaxError>()("FrontendSyntaxError", {
  message: Schema.String,
}) {}

class NoFilesFound extends Schema.TaggedError<NoFilesFound>()("NoFilesFound", {}) {}

function isNoFilesFound(cause: unknown): boolean {
  return cause instanceof Error && cause.name === "NoFilesFoundError";
}

const loadPeer = <A>(name: string, load: () => Promise<A>) =>
  Effect.tryPromise({
    try: load,
    catch: () =>
      new Usage({ message: `cannot load ${name}, which a repository that declares ${DECLARATION} installs beside the kit as an optional peer` }),
  });

const readDeclaration = Effect.fn("readDeclaration")(function* (root: string) {
  const fs = yield* FileSystem.FileSystem;
  const file = (yield* Path.Path).join(root, DECLARATION);
  if (!(yield* fs.exists(file))) {
    return yield* new Usage({ message: `${DECLARATION} is missing, and a repository opts in to this gate by declaring its inputs there` });
  }
  return yield* decodeDeclaration(yield* fs.readFileString(file)).pipe(
    Effect.mapError(({ message }) => new Usage({ message: `${DECLARATION} does not decode: ${message}` })),
  );
});

function violationsOf(result: LintResult, relative: (file: string) => string): readonly Violation[] {
  const file = relative(result.source ?? "");
  return result.warnings.map(({ line, column, rule, text }) => ({
    file,
    line,
    column,
    text: `${text.replace(` (${rule})`, "")}. ${ADVICE[rule] ?? ""}`.trim(),
  }));
}

export const scanInputs = Effect.fn("scanInputs")(function* (root: string, globs: readonly string[]) {
  const path = yield* Path.Path;
  const stylelint = (yield* loadPeer("stylelint", () => import("stylelint"))).default;
  const html = (yield* loadPeer("postcss-html", () => import("postcss-html"))).default;
  const config = { rules: RULES, overrides: [{ files: MARKUP, customSyntax: html }] };
  const relative = (file: string): string => path.relative(root, file);
  const inputs: Input[] = [];
  const violations = new Map<string, Violation>();
  for (const glob of globs) {
    const linted: readonly LintResult[] = yield* Effect.tryPromise({
      try: () => stylelint.lint({ files: glob, cwd: root, config }),
      catch: (cause) => (isNoFilesFound(cause) ? new NoFilesFound() : new FrontendSyntaxError({ message: `stylelint fails on ${glob}: ${String(cause)}` })),
    }).pipe(
      Effect.map(({ results }) => results),
      Effect.catchTag("NoFilesFound", () => Effect.succeed([])),
    );
    const results = linted.filter(({ ignored }) => ignored !== true);
    const invalid = results.flatMap(({ invalidOptionWarnings }) => invalidOptionWarnings.map(({ text }) => text));
    if (invalid.length > 0) return yield* new FrontendSyntaxError({ message: `stylelint refuses the kit's rule options: ${invalid.join("; ")}` });
    inputs.push({ glob, files: results.map((result) => relative(result.source ?? "")).toSorted() });
    for (const violation of results.flatMap((result) => violationsOf(result, relative))) {
      violations.set(`${violation.file}:${violation.line}:${violation.column}:${violation.text}`, violation);
    }
  }
  const byPlace = (a: Violation, b: Violation): number => a.file.localeCompare(b.file) || a.line - b.line || a.column - b.column;
  return { inputs, violations: [...violations.values()].toSorted(byPlace) } satisfies Scan;
});

export function passes({ inputs, violations }: Scan): boolean {
  return violations.length === 0 && inputs.every(({ files }) => files.length > 0);
}

export function report({ inputs, violations }: Scan): string {
  const files = new Set(inputs.flatMap((input) => input.files)).size;
  const scanned = `${files} file(s) from ${inputs.length} declared input(s)`;
  const empty = inputs.filter((input) => input.files.length === 0);
  if (violations.length === 0 && empty.length === 0) return `${NAME}: no violation in ${scanned}`;
  return [
    `${NAME}: ${violations.length + empty.length} problem(s) in ${scanned}:`,
    ...empty.map(({ glob }) => `  ${glob}: the declared input matches no file`),
    ...violations.map(({ file, line, column, text }) => `  ${file}:${line}:${column} ${text}`),
  ].join("\n");
}

const gate = Effect.gen(function* () {
  const root = (yield* Path.Path).resolve(process.argv[2] ?? ".");
  const { inputs } = yield* readDeclaration(root);
  const scan = yield* scanInputs(root, inputs);
  yield* Console.log(report(scan));
  return passes(scan);
});

if (import.meta.main) runMain(NAME, gate);
