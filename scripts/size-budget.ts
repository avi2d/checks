#!/usr/bin/env bun
import { Console, Effect, FileSystem, Path, Schema } from "effect";
import { changedPaths, checkoutFiles, collect, git, pathsAt, rangeEnds, type Change } from "./git.ts";
import { runMain } from "./main.ts";
import { rangeGateInputs } from "./range-gate.ts";
import { diagnosticCode, SIZE_RULES, type LimitKey, type SizeRule } from "./size-rules.ts";

export type Held = { readonly path: string; readonly from: string };

export type Site = {
  readonly file: string;
  readonly line: number | undefined;
  readonly rule: SizeRule["rule"];
  readonly overrun: number;
  readonly message: string;
};

export type Growth = {
  readonly file: string;
  readonly rule: SizeRule["rule"];
  readonly base: number;
  readonly head: number;
  readonly sites: readonly Site[];
};

export type Verdict = { readonly held: number; readonly growths: readonly Growth[]; readonly advisory: readonly Site[] };

class OxlintUnreadable extends Schema.TaggedError<OxlintUnreadable>()("OxlintUnreadable", {
  message: Schema.String,
}) {}

const NAME = "size-budget";
const USAGE = "usage: size-budget.ts <ref> | <base-ref> <head-ref>";
const WHOLE_FILE: LimitKey = "fileLines";
const MAXIMUM = /Maximum allowed is (\d+)/;
const OXLINT_FOUND_NOTHING = 0;
const OXLINT_FOUND_ERRORS = 1;
const SCOPE = "the files the range adds or changes";

const Diagnostic = Schema.Struct({
  code: Schema.optionalKey(Schema.String),
  message: Schema.String,
  help: Schema.optionalKey(Schema.String),
  filename: Schema.optionalKey(Schema.String),
  labels: Schema.optionalKey(Schema.Array(Schema.Struct({ span: Schema.Struct({ line: Schema.Int }) }))),
});
export type Diagnostic = typeof Diagnostic.Type;

const decodeReport = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Struct({ diagnostics: Schema.Array(Diagnostic) })));

export function heldByChange(changes: readonly Change[]): readonly Held[] {
  return changes.flatMap((change) => {
    if (change.kind === "written") return [{ path: change.path, from: change.path }];
    if (change.kind === "renamed" && change.edited) return [{ path: change.path, from: change.from }];
    return [];
  });
}

// oxlint reads files from disk, and the working tree need not hold the head: a merge checkout or an uncommitted edit.
// The repository's config may extend or load a plugin from node_modules, which git does not track.
const treeAt = Effect.fn("treeAt")(function* (root: string, head: string, files: readonly string[], scratch: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  yield* fs.makeDirectory(scratch, { recursive: true });
  const tree = yield* checkoutFiles(head, files, scratch, root);
  yield* fs.makeDirectory(tree, { recursive: true });
  const modules = path.join(root, "node_modules");
  if (yield* fs.exists(modules)) yield* fs.symlink(modules, path.join(tree, "node_modules"));
  return tree;
});

// Each file is written at its head path, so a rename is measured against the limit it is held to now.
const materializeBase = Effect.fn("materializeBase")(function* (root: string, base: string, held: readonly Held[], tree: string) {
  const env = { GIT_INDEX_FILE: `${tree}.index` };
  const found = (yield* git(["cat-file", "--batch-check=%(objecttype) %(objectname)"], root, {
    input: held.map(({ from }) => `${base}:${from}\n`).join(""),
  })).split("\n");
  const entries = held.flatMap(({ path }, index) => {
    const [type, blob] = (found[index] ?? "").split(" ");
    return type === "blob" ? [{ path, entry: `100644 ${blob}\t${path}\0` }] : [];
  });
  if (entries.length === 0) return [];
  yield* git(["update-index", "-z", "--index-info"], root, { env, input: entries.map(({ entry }) => entry).join("") });
  yield* git(["checkout-index", "--all", `--prefix=${tree}/`], root, { env });
  return entries.map(({ path }) => path);
});

export const siteOf = Effect.fn("siteOf")(function* ({ code, message, help = "", filename, labels = [] }: Diagnostic) {
  const rule = SIZE_RULES.find((candidate) => code === diagnosticCode(candidate));
  if (rule === undefined) return [];
  const measured = rule.measured.exec(message)?.[1];
  const max = MAXIMUM.exec(`${message} ${help}`)?.[1];
  if (measured === undefined || max === undefined || filename === undefined) {
    return yield* new OxlintUnreadable({ message: `cannot read ${rule.rule} for ${filename ?? "a file"} from oxlint: ${message}` });
  }
  const wholeFile = rule.key === WHOLE_FILE;
  return [
    {
      file: filename,
      line: wholeFile ? undefined : labels[0]?.span.line,
      rule: rule.rule,
      overrun: Number(measured) - Number(max),
      message: wholeFile ? `${message} Maximum allowed is ${max}.` : message,
    } satisfies Site,
  ];
});

const measure = Effect.fn("measure")(function* (tree: string, paths: readonly string[]) {
  const { stdout, stderr, exitCode } = yield* collect("oxlint", ["-f", "json", ...paths], tree).pipe(
    Effect.mapError((cause) => new OxlintUnreadable({ message: `cannot run oxlint: ${cause.message}` })),
  );
  if (exitCode !== OXLINT_FOUND_NOTHING && exitCode !== OXLINT_FOUND_ERRORS) {
    return yield* new OxlintUnreadable({ message: `oxlint exited ${exitCode}: ${stderr.trim() || stdout.trim()}` });
  }
  const { diagnostics } = yield* decodeReport(stdout).pipe(
    Effect.mapError((cause) => new OxlintUnreadable({ message: `cannot read oxlint's report: ${cause.message}` })),
  );
  const sites = (yield* Effect.forEach(diagnostics, siteOf)).flat();
  return sites.toSorted((a, b) => a.file.localeCompare(b.file) || (a.line ?? 0) - (b.line ?? 0));
});

function byFileAndRule(sites: readonly Site[]): ReadonlyMap<string, readonly Site[]> {
  return Map.groupBy(sites, ({ file, rule }) => `${file}\0${rule}`);
}

function total(sites: readonly Site[]): number {
  return sites.reduce((sum, { overrun }) => sum + overrun, 0);
}

// Sums each rule per file separately, so a shrink in one rule or file never offsets a growth in another.
export function growthsOf(head: readonly Site[], base: readonly Site[]): readonly Growth[] {
  const before = byFileAndRule(base);
  return [...byFileAndRule(head).entries()].flatMap(([group, sites]) => {
    const [first] = sites;
    const growth = { base: total(before.get(group) ?? []), head: total(sites), sites };
    return first !== undefined && growth.head > growth.base ? [{ file: first.file, rule: first.rule, ...growth }] : [];
  });
}

// Decides the verdict from sites oxlint already measured: which the range holds, and which of
// those grew past what the base measured for the same file and rule.
export function verdictOf(held: number, holds: ReadonlySet<string>, sites: readonly Site[], baseSites: readonly Site[]): Verdict {
  const growths = growthsOf(sites.filter((site) => holds.has(site.file)), baseSites);
  const failing = new Set(growths.flatMap((growth) => growth.sites));
  return { held, growths, advisory: sites.filter((site) => !failing.has(site)) };
}

// Both ends run under the head's config, so a changed limit never reads as a change in size.
// Only a held file oxlint finds over a limit at the head can have grown, so only those take their base content.
const runBudget = Effect.fn("runBudget")(
  function* (root: string, base: string, head: string) {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const held = heldByChange(yield* changedPaths(base, head, [], root));
    const holds = new Set(held.map((file) => file.path));
    const files = yield* pathsAt(head, [], root);
    const scratch = yield* fs.makeTempDirectoryScoped({ prefix: "checks-size-budget-" });

    const sites = yield* measure(yield* treeAt(root, head, files, path.join(scratch, "head")), ["."]);
    const overrun = new Set(sites.map((site) => site.file));
    const grown = held.filter((file) => overrun.has(file.path));
    if (grown.length === 0) return verdictOf(held.length, holds, sites, []);
    const replaced = new Set(grown.map((file) => file.path));
    const baseTree = yield* treeAt(root, head, files.filter((file) => !replaced.has(file)), path.join(scratch, "base"));
    const atBase = yield* materializeBase(root, base, grown, baseTree);
    return verdictOf(held.length, holds, sites, atBase.length === 0 ? [] : yield* measure(baseTree, atBase));
  },
  Effect.scoped,
);

export function describe({ file, line, message }: Site, indent = "  "): string {
  return `${indent}${file}${line === undefined ? "" : `:${line}`}: ${message}`;
}

export function verdictLines({ held, growths }: Verdict): readonly string[] {
  if (growths.length === 0) return [`${NAME}: ${held} file(s), ${SCOPE}, raise no overrun past the base`];
  return [
    `${NAME}: ${growths.length} overrun(s) grew past the base in ${SCOPE}:`,
    ...growths.flatMap(({ file, rule, base, head, sites }) => [
      `  ${file}: ${rule} over by ${head} in total, up from ${base}`,
      ...sites.map((site) => describe(site, "    ")),
    ]),
  ];
}

export function report(verdict: Verdict): string {
  const { advisory } = verdict;
  const notice =
    advisory.length === 0
      ? []
      : [`${NAME}: advisory, ${advisory.length} overrun(s) where the budget does not hold yet:`, ...advisory.map((site) => describe(site))];
  return [...verdictLines(verdict), ...notice].join("\n");
}

export function passes(verdict: Verdict): boolean {
  return verdict.growths.length === 0;
}

const budget = Effect.gen(function* () {
  const { refs, root } = yield* rangeGateInputs(USAGE);
  const { base, head } = yield* rangeEnds(refs.first, refs.second, root);
  const verdict = yield* runBudget(root, base, head);

  yield* Console.log(report(verdict));
  return passes(verdict);
});

if (import.meta.main) runMain(NAME, budget);
