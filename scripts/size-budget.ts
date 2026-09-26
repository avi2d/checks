#!/usr/bin/env bun
import { Console, Effect, FileSystem, Path, Schema } from "effect";
import { changedPaths, collect, git, pathsAt, rangeEnds, type Change } from "./git.ts";
import { runMain } from "./main.ts";
import { readSizeRules } from "./native-config.ts";
import { rangeGateInputs } from "./range-gate.ts";
import { budgetOf, diagnosticCode, qualifiedName, SIZE_RULES, type LimitKey, type Limits, type Size, type SizeRule } from "./size-rules.ts";

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
const DECLARATIONS = ":(exclude,glob)**/*.d.ts";
const TYPESCRIPT = [":(glob)**/*.ts", ":(glob)**/*.tsx", DECLARATIONS];
const CONFIG = ".size-budget.oxlintrc.json";
const WHOLE_FILE: LimitKey = "fileLines";
const OXLINT_FOUND_NOTHING = 0;
const OXLINT_FOUND_ERRORS = 1;
const SCOPE = "the production and test files the range adds or changes";

const Diagnostic = Schema.Struct({
  code: Schema.String,
  message: Schema.String,
  filename: Schema.String,
  labels: Schema.Array(Schema.Struct({ span: Schema.Struct({ line: Schema.Int }) })),
});

const decodeReport = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Struct({ diagnostics: Schema.Array(Diagnostic) })));

type Rules = Readonly<Record<string, unknown>>;

export type SizeConfig = {
  readonly plugins: readonly string[];
  readonly jsPlugins: readonly string[];
  readonly categories: Readonly<Record<string, string>>;
  readonly rules: Rules;
  readonly overrides: readonly { readonly files: readonly string[]; readonly excludeFiles: readonly string[]; readonly rules: Rules }[];
};

function rulesOf(limits: Limits, rules: readonly SizeRule[]): Rules {
  return Object.fromEntries(
    rules.map((entry) => {
      const max = limits[entry.key];
      return [qualifiedName(entry), max === undefined || max === "off" ? "off" : ["error", { max, ...entry.options }]];
    }),
  );
}

export function sizeConfig({ limits, scopes }: Size, plugin: string): SizeConfig {
  return {
    plugins: [],
    jsPlugins: [plugin],
    categories: { correctness: "off" },
    rules: rulesOf(limits, SIZE_RULES),
    overrides: scopes.map(({ files, excludeFiles, limits: set }) => ({
      files,
      excludeFiles,
      rules: rulesOf(set, SIZE_RULES.filter(({ key }) => key in set)),
    })),
  };
}

export function heldByChange(changes: readonly Change[]): readonly Held[] {
  return changes.flatMap((change) => {
    if (change.kind === "written") return [{ path: change.path, from: change.path }];
    if (change.kind === "renamed" && change.edited) return [{ path: change.path, from: change.from }];
    return [];
  });
}

// oxlint reads files from disk, and the working tree need not hold the head: a merge checkout or an uncommitted edit.
const materializeHead = Effect.fn("materializeHead")(function* (root: string, head: string, files: readonly string[], tree: string) {
  const env = { GIT_INDEX_FILE: `${tree}.index` };
  yield* git(["read-tree", head], root, { env });
  yield* git(["checkout-index", "-z", "--stdin", `--prefix=${tree}/`], root, { env, input: files.map((file) => `${file}\0`).join("") });
});

// Each file is written at its head path, so a rename is measured against the budget it is held to now.
const materializeBase = Effect.fn("materializeBase")(function* (root: string, base: string, held: readonly Held[], tree: string) {
  const env = { GIT_INDEX_FILE: `${tree}.index` };
  const found = (yield* git(["cat-file", "--batch-check=%(objecttype) %(objectname)"], root, {
    input: held.map(({ from }) => `${base}:${from}\n`).join(""),
  })).split("\n");
  const entries = held.flatMap(({ path }, index) => {
    const [type, blob] = (found[index] ?? "").split(" ");
    return type === "blob" ? [`100644 ${blob}\t${path}\0`] : [];
  });
  if (entries.length === 0) return;
  yield* git(["update-index", "-z", "--index-info"], root, { env, input: entries.join("") });
  yield* git(["checkout-index", "--all", `--prefix=${tree}/`], root, { env });
});

export const siteOf = (
  size: Size,
): ((diagnostic: typeof Diagnostic.Type) => Effect.Effect<readonly Site[], OxlintUnreadable>) =>
  Effect.fn("siteOf")(function* ({ code, message, filename, labels }: typeof Diagnostic.Type) {
    const rule = SIZE_RULES.find((candidate) => code === diagnosticCode(candidate));
    if (rule === undefined) return [];
    const measured = rule.measured.exec(message)?.[1];
    const max = budgetOf(size, filename)[rule.key];
    if (measured === undefined || max === undefined) {
      return yield* new OxlintUnreadable({ message: `cannot read ${rule.rule} for ${filename} from oxlint: ${message}` });
    }
    const wholeFile = rule.key === WHOLE_FILE;
    return [
      {
        file: filename,
        line: wholeFile ? undefined : labels[0]?.span.line,
        rule: rule.rule,
        overrun: Number(measured) - max,
        message: wholeFile ? `${message} Maximum allowed is ${max}.` : message,
      } satisfies Site,
    ];
  });

const measure = Effect.fn("measure")(function* (tree: string, size: Size, plugin: string) {
  const fs = yield* FileSystem.FileSystem;
  if (!(yield* fs.exists(tree))) return [];
  // oxlint reads an override's glob from the directory of the config that holds it, so the config sits in the tree.
  yield* fs.writeFileString((yield* Path.Path).join(tree, CONFIG), `${JSON.stringify(sizeConfig(size, plugin), null, 2)}\n`);

  const { stdout, stderr, exitCode } = yield* collect("oxlint", ["-c", CONFIG, "-f", "json", "."], tree).pipe(
    Effect.mapError((cause) => new OxlintUnreadable({ message: `cannot run oxlint: ${cause.message}` })),
  );
  if (exitCode !== OXLINT_FOUND_NOTHING && exitCode !== OXLINT_FOUND_ERRORS) {
    return yield* new OxlintUnreadable({ message: `oxlint exited ${exitCode}: ${stderr.trim() || stdout.trim()}` });
  }
  const { diagnostics } = yield* decodeReport(stdout).pipe(
    Effect.mapError((cause) => new OxlintUnreadable({ message: `cannot read oxlint's report: ${cause.message}` })),
  );
  const sites = (yield* Effect.forEach(diagnostics, siteOf(size))).flat();
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

const runBudget = Effect.fn("runBudget")(
  function* (root: string, size: Size, base: string, head: string) {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const pathspecs = [...size.scopes.flatMap(({ files }) => files.map((glob) => `:(glob)${glob}`)), DECLARATIONS];
    const held = heldByChange(yield* changedPaths(base, head, pathspecs, root));
    const holds = new Set(held.map((file) => file.path));
    const others = (yield* pathsAt(head, TYPESCRIPT, root)).filter((file) => !holds.has(file));
    const scratch = yield* fs.makeTempDirectoryScoped({ prefix: "checks-size-budget-" });

    const headTree = path.join(scratch, "head");
    if (held.length + others.length > 0) yield* materializeHead(root, head, [...holds, ...others], headTree);
    const plugin = path.join(import.meta.dir, "..", "dist", "index.js");
    const sites = yield* measure(headTree, size, plugin);

    const baseTree = path.join(scratch, "base");
    if (held.length > 0) yield* materializeBase(root, base, held, baseTree);
    return verdictOf(held.length, holds, sites, yield* measure(baseTree, size, plugin));
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
  const configured = yield* readSizeRules(root);
  if (configured === undefined) {
    yield* Console.log(`${NAME}: .oxlintrc.json declares no size rules`);
    return true;
  }
  const { base, head } = yield* rangeEnds(refs.first, refs.second, root);
  const verdict = yield* runBudget(root, configured.size, base, head);

  yield* Console.log(report(verdict));
  return passes(verdict);
});

if (import.meta.main) runMain(NAME, budget);
