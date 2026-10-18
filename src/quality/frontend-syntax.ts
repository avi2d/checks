#!/usr/bin/env bun
import { Effect, FileSystem, Path, Schema } from "effect";
import type { Config, LinterOptions, LintResult } from "stylelint";
import { declaredGate, emptyInputs, inputsReport, violationLine, type Declared, type Input, type Violation } from "../core/declared-inputs.ts";
import { runMain, Usage } from "../core/main.ts";
import { MARKUP } from "./presets/stylelint.ts";

const DECLARED: Declared = { name: "frontend-syntax", file: "frontend-syntax.json", declares: "inputs" };

const STYLELINT_CONFIG = "stylelint.config.ts";

const USAGE = "usage: frontend-syntax.ts [--fix] [--suppress] [<directory>]";

const TRANSITION_ALL = "declaration-property-value-disallowed-list";
const BODY_WIDE_USER_SELECT = "rule-selector-property-disallowed-list";
const UNPARSED = "CssSyntaxError";

const RULES = {
  [TRANSITION_ALL]: [{ "/^(?:-[a-z]+-)?transition(?:-property)?$/": ["/(?:^|[\\s,])all(?:[\\s,]|$)/i"] }],
  [BODY_WIDE_USER_SELECT]: [{ "/(?:^|,)\\s*(?:html|body|:root|\\*|:global\\(\\s*(?:html|body|:root|\\*)\\s*\\))\\s*(?:,|$)/": ["/^(?:-[a-z]+-)?user-select$/"] }],
} as const;

type Advice = Readonly<Record<string, string>>;

const UNPARSED_ADVICE: Advice = { [UNPARSED]: "The gate judges only what parses." };

const KIT_ADVICE: Advice = {
  [TRANSITION_ALL]: "Name the properties the transition animates.",
  [BODY_WIDE_USER_SELECT]: "Leave text selectable across the page, and turn selection off only on the control that needs it.",
  ...UNPARSED_ADVICE,
};

export type Scan = {
  readonly inputs: readonly Input[];
  readonly violations: readonly Violation[];
};

type Options = { readonly fix: boolean; readonly suppress: boolean };

type Pass = { readonly config: Config; readonly advice: Advice; readonly refuses: string };

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

const ConfigModule = Schema.Struct({ default: Schema.Record(Schema.String, Schema.Unknown) });

const decodeConfigModule = Schema.decodeUnknownEffect(ConfigModule);

const loadRepositoryConfig = Effect.fn("loadRepositoryConfig")(function* (root: string) {
  const fs = yield* FileSystem.FileSystem;
  const file = (yield* Path.Path).join(root, STYLELINT_CONFIG);
  if (!(yield* fs.exists(file))) {
    return yield* new Usage({
      message: `${STYLELINT_CONFIG} is missing, and a repository that declares ${DECLARED.file} writes it with defineConfig from @avi2dg/checks/stylelint`,
    });
  }
  const loaded: unknown = yield* Effect.tryPromise({
    try: () => import(file),
    catch: (cause) => new Usage({ message: `${STYLELINT_CONFIG} does not load: ${String(cause)}` }),
  });
  const module = yield* decodeConfigModule(loaded).pipe(
    Effect.mapError(() => new Usage({ message: `${STYLELINT_CONFIG} has no default export of a stylelint config object` })),
  );
  return module.default;
});

function violationsOf(result: LintResult, relative: (file: string) => string, advice: Advice): readonly Violation[] {
  const file = relative(result.source ?? "");
  return result.warnings.map(({ line, column, rule, text }) => {
    const advised = advice[rule];
    return { file, line, column, text: advised === undefined ? text : `${text.replace(` (${rule})`, "")}. ${advised}` };
  });
}

const lintWith = (root: string, pass: Pass, options: Partial<LinterOptions>) =>
  Effect.gen(function* () {
    const stylelint = (yield* loadPeer("stylelint", () => import("stylelint"))).default;
    const files = options.files ?? [];
    const linted: readonly LintResult[] = yield* Effect.tryPromise({
      try: () => stylelint.lint({ ...options, cwd: root, configBasedir: root, config: pass.config, ignoreDisables: true }),
      catch: (cause) => (isNoFilesFound(cause) ? new NoFilesFound() : new FrontendSyntaxError({ message: `stylelint fails on ${String(files)}: ${String(cause)}` })),
    }).pipe(
      Effect.map(({ results }) => results),
      Effect.catchTag("NoFilesFound", () => Effect.succeed([])),
    );
    const results = linted.filter(({ ignored }) => ignored !== true);
    const invalid = results.flatMap(({ invalidOptionWarnings }) => invalidOptionWarnings.map(({ text }) => text));
    if (invalid.length > 0) return yield* new FrontendSyntaxError({ message: `stylelint refuses ${pass.refuses}: ${[...new Set(invalid)].join("; ")}` });
    return results;
  });

const passesFor = Effect.fn("passesFor")(function* (root: string) {
  const html = (yield* loadPeer("postcss-html", () => import("postcss-html"))).default;
  const kit: Pass = { config: { rules: RULES, overrides: [{ files: [...MARKUP], customSyntax: html }] }, advice: KIT_ADVICE, refuses: "the kit's rule options" };
  const repository: Pass = {
    config: { ...(yield* loadRepositoryConfig(root)), quiet: false },
    advice: UNPARSED_ADVICE,
    refuses: `an option in ${STYLELINT_CONFIG}`,
  };
  return { kit, repository };
});

export const scanInputs = Effect.fn("scanInputs")(function* (root: string, globs: readonly string[], { fix, suppress }: Options) {
  const path = yield* Path.Path;
  // stylelint keys its suppressions file on the process directory rather than on its cwd option.
  yield* Effect.sync(() => process.chdir(root));
  const { kit, repository } = yield* passesFor(root);
  if (suppress) yield* lintWith(root, repository, { files: [...globs], fix, suppressAll: true, allowEmptyInput: true });
  const relative = (file: string): string => path.relative(root, file);
  const inputs: Input[] = [];
  const violations = new Map<string, Violation>();
  for (const glob of globs) {
    const judged = yield* lintWith(root, repository, { files: glob, fix });
    const ruled = yield* lintWith(root, kit, { files: glob });
    inputs.push({ glob, files: judged.map((result) => relative(result.source ?? "")).toSorted() });
    const found = [...ruled.flatMap((result) => violationsOf(result, relative, kit.advice)), ...judged.flatMap((result) => violationsOf(result, relative, repository.advice))];
    for (const violation of found) violations.set(`${violation.file}:${violation.line}:${violation.column}:${violation.text}`, violation);
  }
  const byPlace = (a: Violation, b: Violation): number => a.file.localeCompare(b.file) || a.line - b.line || a.column - b.column || a.text.localeCompare(b.text);
  return { inputs, violations: [...violations.values()].toSorted(byPlace) } satisfies Scan;
});

export function passes({ inputs, violations }: Scan): boolean {
  return violations.length === 0 && emptyInputs(inputs).length === 0;
}

export function report({ inputs, violations }: Scan): string {
  const empty = emptyInputs(inputs).map(({ glob }) => `${glob}: the declared input matches no file`);
  return inputsReport(DECLARED.name, inputs, [...empty, ...violations.map(violationLine)]);
}

type Arguments = Options & { readonly directory: string | undefined };

export const parseArguments = Effect.fn("parseArguments")(function* (args: readonly string[]) {
  const flags = new Set(args.filter((arg) => arg.startsWith("--")));
  const directories = args.filter((arg) => !arg.startsWith("--"));
  const unknown = [...flags].filter((flag) => flag !== "--fix" && flag !== "--suppress");
  if (unknown.length > 0 || directories.length > 1) return yield* new Usage({ message: USAGE });
  return { fix: flags.has("--fix"), suppress: flags.has("--suppress"), directory: directories[0] } satisfies Arguments;
});

const gate = Effect.gen(function* () {
  const { directory, ...options } = yield* parseArguments(process.argv.slice(2));
  return yield* declaredGate(DECLARED, (root, globs) => scanInputs(root, globs, options), { report, passes }, directory);
});

if (import.meta.main) runMain(DECLARED.name, gate);
