#!/usr/bin/env bun
import { Effect, Path, Schema } from "effect";
import type { LintResult } from "stylelint";
import { emptyInputs, inputsReport, runDeclaredGate, violationLine, type Declared, type Input, type Violation } from "../core/declared-inputs.ts";
import { Usage } from "../core/main.ts";

const DECLARED: Declared = { name: "frontend-syntax", file: "frontend-syntax.json", declares: "inputs" };

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
      new Usage({ message: `cannot load ${name}, which a repository that declares ${DECLARED.file} installs beside the kit as an optional peer` }),
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
  return violations.length === 0 && emptyInputs(inputs).length === 0;
}

export function report({ inputs, violations }: Scan): string {
  const empty = emptyInputs(inputs).map(({ glob }) => `${glob}: the declared input matches no file`);
  return inputsReport(DECLARED.name, inputs, [...empty, ...violations.map(violationLine)]);
}

if (import.meta.main) runDeclaredGate(DECLARED, scanInputs, { report, passes });
