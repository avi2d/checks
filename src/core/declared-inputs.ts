import type { BunServices } from "@effect/platform-bun";
import { Console, Effect, Path } from "effect";
import type { DeclaredSetting } from "./gates.ts";
import { runMain, Usage } from "./main.ts";
import { Inputs, readSetting, SETTINGS_FILE } from "./settings.ts";

export type Declared = DeclaredSetting & {
  readonly name: string;
  readonly declares: string;
};

export type Input = {
  readonly glob: string;
  readonly files: readonly string[];
};

export type Violation = {
  readonly file: string;
  readonly line: number;
  readonly column: number;
  readonly text: string;
};

export type Verdict<S> = {
  readonly report: (scan: S) => string;
  readonly passes: (scan: S) => boolean;
};

const readInputs = Effect.fn("readInputs")(function* (root: string, { setting, oldFile, declares }: Declared) {
  const declared = yield* readSetting(root, setting, Inputs, { file: oldFile });
  if (declared === undefined) {
    return yield* new Usage({ message: `${SETTINGS_FILE} sets no ${setting} key, and a repository opts in to this gate by declaring its ${declares} there` });
  }
  return declared.inputs;
});

export function emptyInputs(inputs: readonly Input[]): readonly Input[] {
  return inputs.filter(({ files }) => files.length === 0);
}

export function violationLine({ file, line, column, text }: Violation): string {
  return `${file}:${line}:${column} ${text}`;
}

export function inputsReport(name: string, inputs: readonly Input[], problems: readonly string[]): string {
  const files = new Set(inputs.flatMap((input) => input.files)).size;
  const scanned = `${files} file(s) from ${inputs.length} declared input(s)`;
  if (problems.length === 0) return `${name}: no violation in ${scanned}`;
  return [`${name}: ${problems.length} problem(s) in ${scanned}:`, ...problems.map((problem) => `  ${problem}`)].join("\n");
}

export const declaredGate = Effect.fn("declaredGate")(function* <S, E>(
  declared: Declared,
  scanInputs: (root: string, globs: readonly string[]) => Effect.Effect<S, E, BunServices.BunServices>,
  { report, passes }: Verdict<S>,
  directory: string | undefined,
) {
  const root = (yield* Path.Path).resolve(directory ?? ".");
  const scan = yield* scanInputs(root, yield* readInputs(root, declared));
  yield* Console.log(report(scan));
  return passes(scan);
});

export function runDeclaredGate<S, E extends { readonly message: string }>(
  declared: Declared,
  scanInputs: (root: string, globs: readonly string[]) => Effect.Effect<S, E, BunServices.BunServices>,
  verdict: Verdict<S>,
): void {
  runMain(declared.name, declaredGate(declared, scanInputs, verdict, process.argv[2]));
}
