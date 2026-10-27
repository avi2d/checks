#!/usr/bin/env bun
import { BunRuntime, BunServices } from "@effect/platform-bun";
import { Cause, Console, Effect, Exit, FileSystem, Path, Schema } from "effect";
import { LINTED_SOURCE, TYPESCRIPT_SOURCE, type TrackedContent } from "../core/gates.ts";
import { checkoutFiles, collect, commitOf, git, pathsAt, rangeEnds, refArgs } from "../core/git.ts";
import { Usage } from "../core/main.ts";
import { knipReport } from "./knip.ts";

const NAME = "graphwalk";
const UNUSED = "unused";
const EXPORTS = "exports";
const IMPORTS = "imports";
const WRITE = "--write";
const USAGE = `usage: graphwalk.ts [<ref> | <base-ref> <head-ref> | ${WRITE}]`;

const INCLUDED = ["--include", "files,exports,types"];
const JUDGED = /[.]tsx?$|[.]astro$/;

export const BASELINE_FILE = "exports-baseline.json";

export const PROJECT_CONFIG = "dependency-cruiser.config.ts";

export const OWN_CONFIGS = [
  ".dependency-cruiser.json",
  ".dependency-cruiser.js",
  ".dependency-cruiser.cjs",
  ".dependency-cruiser.mjs",
  ".dependency-cruiser.ts",
  ".dependency-cruiser.cts",
  ".dependency-cruiser.mts",
] as const;

export const CRUISED = ["*.ts", "*.tsx", "*.mts", "*.cts"] as const;

const KIT_DEFAULTS = "kit-defaults.ts";

const PASSED = 0;
const VIOLATED = 1;
const UNDECIDED = 2;
const INTERRUPTED = 130;

export type Status = "passed" | "violated" | "undecided";

class GraphwalkError extends Schema.TaggedError<GraphwalkError>()("GraphwalkError", {
  message: Schema.String,
}) {}

const UnusedSymbolSchema = Schema.Struct({
  file: Schema.String,
  kind: Schema.Literals(["export", "type"]),
  name: Schema.String,
});

export type UnusedSymbol = typeof UnusedSymbolSchema.Type;

export type Baseline = readonly UnusedSymbol[];

export type Drift = {
  readonly unlisted: readonly UnusedSymbol[];
  readonly added: readonly UnusedSymbol[];
  readonly stale: readonly UnusedSymbol[];
};

const Violation = Schema.Struct({
  from: Schema.String,
  to: Schema.String,
  rule: Schema.Struct({ name: Schema.String, severity: Schema.String }),
});

export type Violation = typeof Violation.Type;

const decodeKnipFiles = Schema.decodeUnknownEffect(
  Schema.fromJsonString(
    Schema.Struct({
      issues: Schema.Array(Schema.Struct({ files: Schema.optional(Schema.Array(Schema.Struct({ name: Schema.String }))) })),
    }),
  ),
);

const decodeKnipSymbols = Schema.decodeUnknownEffect(
  Schema.fromJsonString(
    Schema.Struct({
      issues: Schema.Array(
        Schema.Struct({
          file: Schema.String,
          exports: Schema.optional(Schema.Array(Schema.Struct({ name: Schema.String }))),
          types: Schema.optional(Schema.Array(Schema.Struct({ name: Schema.String }))),
        }),
      ),
    }),
  ),
);

const decodeBaseline = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Array(UnusedSymbolSchema)));

const decodeCruise = Schema.decodeUnknownEffect(
  Schema.fromJsonString(
    Schema.Struct({
      summary: Schema.Struct({ violations: Schema.Array(Violation), error: Schema.Int, totalCruised: Schema.Int }),
    }),
  ),
);

function byPosition(a: UnusedSymbol, b: UnusedSymbol): number {
  return a.file.localeCompare(b.file) || a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name);
}

const keyOf = ({ file, kind, name }: UnusedSymbol): string => `${kind}\0${file}\0${name}`;

function outside(symbols: readonly UnusedSymbol[], others: readonly UnusedSymbol[]): readonly UnusedSymbol[] {
  const known = new Set(others.map(keyOf));
  return symbols.filter((symbol) => !known.has(keyOf(symbol))).toSorted(byPosition);
}

function describe(symbol: UnusedSymbol): string {
  return `  ${symbol.file}: ${symbol.name} (${symbol.kind})`;
}

export const filesOf = Effect.fn("filesOf")(function* (stdout: string) {
  const { issues } = yield* decodeKnipFiles(stdout).pipe(
    Effect.mapError((cause) => new GraphwalkError({ message: `knip's JSON report does not decode: ${cause.message}` })),
  );
  return issues
    .flatMap(({ files = [] }) => files.map(({ name }) => name))
    .filter((file) => JUDGED.test(file))
    .toSorted();
});

export function unusedReport({ tracked, files }: { readonly tracked: number; readonly files: readonly string[] }): string {
  if (files.length === 0) return `${UNUSED}: no unreferenced files among ${tracked} tracked .ts/.tsx/.astro file(s)`;
  return [`${UNUSED}: ${files.length} unreferenced file(s):`, ...files.map((file) => `  ${file}`)].join("\n");
}

export const symbolsOf = Effect.fn("symbolsOf")(function* (stdout: string) {
  const { issues } = yield* decodeKnipSymbols(stdout).pipe(
    Effect.mapError((cause) => new GraphwalkError({ message: `knip's JSON report does not decode: ${cause.message}` })),
  );
  return issues
    .flatMap(({ file, exports = [], types = [] }): readonly UnusedSymbol[] => [
      ...exports.map(({ name }): UnusedSymbol => ({ file, kind: "export", name })),
      ...types.map(({ name }): UnusedSymbol => ({ file, kind: "type", name })),
    ])
    .toSorted(byPosition);
});

export const baselineOf = Effect.fn("baselineOf")(function* (text: string, where: string) {
  return yield* decodeBaseline(text).pipe(
    Effect.mapError((cause) => new GraphwalkError({ message: `${where} does not decode: ${cause.message}` })),
  );
});

export function driftOf({
  reported,
  base,
  head,
  unusedAtBase,
}: {
  readonly reported: Baseline;
  readonly base: Baseline;
  readonly head: Baseline;
  readonly unusedAtBase: Baseline;
}): Drift {
  return {
    unlisted: outside(reported, head),
    added: outside(head, [...base, ...unusedAtBase]),
    stale: outside(head, reported),
  };
}

export function exportsReport(head: Baseline, { unlisted, added, stale }: Drift): string {
  const sections = [
    { symbols: unlisted, what: `unused export(s) not in ${BASELINE_FILE}:` },
    { symbols: added, what: `${BASELINE_FILE} export(s) the range adds that its base did not leave unused, remove the export instead:` },
    { symbols: stale, what: `${BASELINE_FILE} export(s) no longer reported, remove them:` },
  ].filter(({ symbols }) => symbols.length > 0);
  if (sections.length > 0) {
    return sections.flatMap(({ symbols, what }) => [`${EXPORTS}: ${symbols.length} ${what}`, ...symbols.map(describe)]).join("\n");
  }
  return head.length === 0
    ? `${EXPORTS}: no unused exports or types`
    : `${EXPORTS}: ${head.length} unused export(s) in ${BASELINE_FILE}, and no new ones`;
}

export function describeViolation({ from, to, rule }: Violation): string {
  return from === to ? `  ${rule.severity} ${rule.name}: ${from}` : `  ${rule.severity} ${rule.name}: ${from} → ${to}`;
}

const unconfiguredLine = (section: string): string =>
  `${section}: no knip configuration names entry files, so add a knip.config.ts calling defineConfig from @avi2dg/checks/knip`;

const trackedIn = Effect.fn("trackedIn")(function* (root: string, source: TrackedContent) {
  return (yield* git(["ls-files", "--", ...source.pathspecs], root))
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
});

const baselinePath = Effect.fn("baselinePath")(function* (root: string) {
  return (yield* Path.Path).join(root, BASELINE_FILE);
});

const baselineInTree = Effect.fn("baselineInTree")(function* (root: string) {
  const fs = yield* FileSystem.FileSystem;
  const at = yield* baselinePath(root);
  if (!(yield* fs.exists(at))) return [] satisfies Baseline;
  return yield* fs.readFileString(at).pipe(Effect.flatMap((text) => baselineOf(text, BASELINE_FILE)));
});

const baselineAt = Effect.fn("baselineAt")(function* (treeish: string, root: string) {
  const blob = (yield* git(["ls-tree", "--object-only", treeish, "--", BASELINE_FILE], root)).trim();
  if (blob === "") return [] satisfies Baseline;
  return yield* baselineOf(yield* git(["cat-file", "blob", blob], root), `${BASELINE_FILE} at ${treeish}`);
});

// Knip loads the configuration's imports, such as the kit's knip builder, from a node_modules the checkout lacks.
const unusedAt = Effect.fn("unusedAt")(
  function* (rev: string, root: string) {
    const files = yield* pathsAt(rev, [], root);
    if (files.length === 0) return [] satisfies Baseline;
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const tree = yield* checkoutFiles(rev, files, yield* fs.makeTempDirectoryScoped({ prefix: "checks-graphwalk-" }), root);
    const modules = path.join(root, "node_modules");
    if (yield* fs.exists(modules)) yield* fs.symlink(modules, path.join(tree, "node_modules"));
    const reported = yield* knipReport(tree, INCLUDED).pipe(
      Effect.mapError((cause) => new GraphwalkError({ message: `at ${rev}: ${cause.message}` })),
    );
    return reported.kind === "unconfigured" ? [] : yield* symbolsOf(reported.stdout);
  },
  Effect.scoped,
);

// Knip scans the checked-out tree, and a pull request's merge checkout holds the base branch tip beside the range head.
const judgedBase = Effect.fn("judgedBase")(function* (first: string, second: string | undefined, root: string) {
  const { base } = yield* rangeEnds(first, second, root);
  if (second === undefined) return base;
  const head = yield* commitOf(second, root);
  const parents = (yield* git(["rev-parse", "HEAD^@"], root)).split("\n").filter((line) => line !== "");
  const [other, ...rest] = parents.filter((parent) => parent !== head);
  return parents.includes(head) && other !== undefined && rest.length === 0 ? other : base;
});

const configOf = Effect.fn("configOf")(function* (root: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  for (const name of [PROJECT_CONFIG, ...OWN_CONFIGS]) {
    if (yield* fs.exists(path.join(root, name))) return { file: name, shown: name };
  }
  return { file: path.join(import.meta.dir, "..", "dependencies", KIT_DEFAULTS), shown: "the kit's defaults" };
});

const depcruise = Effect.fn("depcruise")(function* () {
  const path = yield* Path.Path;
  const main = yield* Effect.try({
    try: () => new URL("../../bin/dependency-cruiser.mjs", import.meta.resolve("dependency-cruiser")),
    catch: () => new GraphwalkError({ message: "cannot resolve dependency-cruiser, a peer dependency of the kit" }),
  });
  return yield* path.fromFileUrl(main);
});

const trackedInTree = Effect.fn("trackedInTree")(function* (root: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const listed = yield* git(["ls-files", "-z", "--", ...CRUISED], root);
  return yield* Effect.filter(listed.split("\0").filter(Boolean), (file) => fs.exists(path.join(root, file)), { concurrency: "unbounded" });
});

const runSection = Effect.fn("runSection")(function* (
  section: string,
  body: Effect.Effect<Status, { readonly message: string }, BunServices.BunServices>,
) {
  return yield* body.pipe(
    Effect.catch((cause) => Console.error(`${section}: ${cause.message}`).pipe(Effect.as<Status>("undecided"))),
  );
});

const unusedSection = (tracked: number, stdout: string) =>
  runSection(
    UNUSED,
    Effect.gen(function* () {
      const files = yield* filesOf(stdout);
      yield* Console.log(unusedReport({ tracked, files }));
      return files.length === 0 ? "passed" : "violated";
    }),
  );

const exportsSection = (root: string, stdout: string, first: string, second: string | undefined) =>
  runSection(
    EXPORTS,
    Effect.gen(function* () {
      const head = yield* baselineInTree(root);
      const reported = yield* symbolsOf(stdout);
      const baseRev = yield* judgedBase(first, second, root);
      const base = yield* baselineAt(baseRev, root);
      const unusedAtBase = outside(head, base).length === 0 ? [] : yield* unusedAt(baseRev, root);
      const drift = driftOf({ reported, base, head, unusedAtBase });
      yield* Console.log(exportsReport(head, drift));
      return drift.unlisted.length === 0 && drift.added.length === 0 && drift.stale.length === 0 ? "passed" : "violated";
    }),
  );

const importsSection = (root: string) =>
  runSection(
    IMPORTS,
    Effect.gen(function* () {
      const files = yield* trackedInTree(root);
      if (files.length === 0) return yield* new GraphwalkError({ message: "no tracked TypeScript to cruise" });
      const config = yield* configOf(root);
      const run = yield* collect(process.execPath, [yield* depcruise(), "--config", config.file, "--output-type", "json", ...files], root).pipe(
        Effect.mapError((cause) => new GraphwalkError({ message: `cannot run dependency-cruiser: ${cause.message}` })),
      );
      const { summary } = yield* decodeCruise(run.stdout).pipe(
        Effect.mapError(
          () => new GraphwalkError({ message: `dependency-cruiser exits ${run.exitCode} with no report: ${(run.stdout + run.stderr).trim()}` }),
        ),
      );
      const cruised = `${summary.totalCruised} module(s) cruised against ${config.shown}`;
      if (summary.violations.length === 0) {
        yield* Console.log(`${IMPORTS}: ${cruised}, no violation`);
        return "passed";
      }
      yield* Console.error(
        [`${IMPORTS}: ${summary.violations.length} violation(s) in ${cruised}`, ...summary.violations.map(describeViolation)].join("\n"),
      );
      return summary.error === 0 ? "passed" : "violated";
    }),
  );

function exitOf(statuses: readonly Status[]): number {
  if (statuses.includes("violated")) return VIOLATED;
  if (statuses.includes("undecided")) return UNDECIDED;
  return PASSED;
}

const seed = Effect.fn("seed")(function* (root: string, tracked: number) {
  if (tracked === 0) return yield* new GraphwalkError({ message: "no tracked TypeScript source to scan" });
  const reported = yield* knipReport(root, INCLUDED).pipe(Effect.mapError((cause) => new GraphwalkError({ message: cause.message })));
  if (reported.kind === "unconfigured") {
    yield* Console.log(unconfiguredLine(EXPORTS));
    return VIOLATED;
  }
  const symbols = yield* symbolsOf(reported.stdout);
  yield* (yield* FileSystem.FileSystem).writeFileString(yield* baselinePath(root), `${JSON.stringify(symbols, null, 2)}\n`);
  yield* Console.log(`${EXPORTS}: wrote ${symbols.length} unused export(s) to ${BASELINE_FILE}`);
  return PASSED;
});

const gate = Effect.gen(function* () {
  const args = process.argv.slice(2);
  const root = (yield* git(["rev-parse", "--show-toplevel"])).trim();
  if (args.length === 1 && args[0] === WRITE) {
    const tracked = yield* trackedIn(root, TYPESCRIPT_SOURCE);
    return yield* seed(root, tracked.length).pipe(
      Effect.catch((cause: { readonly message: string }) => Console.error(`${EXPORTS}: ${cause.message}`).pipe(Effect.as(UNDECIDED))),
    );
  }
  const linted = yield* trackedIn(root, LINTED_SOURCE);
  if (linted.length === 0) return yield* new GraphwalkError({ message: "no tracked TypeScript or Astro source to scan" });
  const { first, second } = args.length === 0 ? { first: "HEAD", second: undefined } : yield* refArgs(args, USAGE);
  const typescript = yield* trackedIn(root, TYPESCRIPT_SOURCE);
  const knipOutcome = yield* knipReport(root, INCLUDED).pipe(
    Effect.mapError((cause) => new GraphwalkError({ message: cause.message })),
    Effect.map((reported) => ({ failed: false as const, reported })),
    Effect.catch((cause: { readonly message: string }) => Effect.succeed({ failed: true as const, message: cause.message })),
  );
  if (knipOutcome.failed) {
    yield* Console.error(`${UNUSED}: ${knipOutcome.message}`);
    if (typescript.length === 0) return UNDECIDED;
    yield* Console.error(`${EXPORTS}: ${knipOutcome.message}`);
    const cruised = yield* importsSection(root);
    return exitOf(["undecided", "undecided", cruised]);
  }
  const reported = knipOutcome.reported;
  if (reported.kind === "unconfigured") {
    yield* Console.log(unconfiguredLine(UNUSED));
    yield* Console.log(unconfiguredLine(EXPORTS));
    const cruised = typescript.length === 0 ? "passed" : yield* importsSection(root);
    return exitOf(["violated", "violated", cruised]);
  }
  const unlisted = yield* unusedSection(linted.length, reported.stdout);
  if (typescript.length === 0) return exitOf([unlisted]);
  const drifted = yield* exportsSection(root, reported.stdout, first, second);
  const cruised = yield* importsSection(root);
  return exitOf([unlisted, drifted, cruised]);
}).pipe(
  Effect.catch((cause: { readonly message: string }) =>
    (cause instanceof Usage ? Console.error(`${NAME}: ${cause.message}`) : Console.error(`${UNUSED}: ${cause.message}`)).pipe(
      Effect.as(UNDECIDED),
    ),
  ),
);

function statusOf<A, E>(exit: Exit.Exit<A, E>): number {
  if (Exit.isSuccess(exit)) return typeof exit.value === "number" ? exit.value : UNDECIDED;
  return Cause.hasInterruptsOnly(exit.cause) ? INTERRUPTED : UNDECIDED;
}

// runMain carries only pass or fail, so this gate returns its exit code from the program the runtime runs.
const program = gate.pipe(Effect.provide(BunServices.layer));

if (import.meta.main) {
  BunRuntime.runMain(program, { teardown: (exit, onExit) => onExit(statusOf(exit)) });
}
