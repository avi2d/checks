#!/usr/bin/env bun
import { Console, Effect, FileSystem, Path, Schema } from "effect";
import { changedPaths, collect, git, pathsAt, rangeEnds, type Change } from "./git.ts";
import { runMain } from "./main.ts";
import { renderJson } from "./quality-file.ts";
import { rangeGateInputs } from "./range-gate.ts";
import {
  budgetOf,
  budgetsOf,
  diagnosticCode,
  qualifiedName,
  SIZE_DEFAULTS,
  SIZE_RULES,
  TESTS_DIRECTORY,
  type Applies,
  type Budget,
  type Budgets,
  type LimitKey,
  type Size,
  type SizeRule,
} from "./size-rules.ts";

type Held = { readonly path: string; readonly from: string };

type Site = {
  readonly file: string;
  readonly line: number | undefined;
  readonly rule: SizeRule["rule"];
  readonly overrun: number;
  readonly message: string;
};

type Growth = {
  readonly file: string;
  readonly rule: SizeRule["rule"];
  readonly base: number;
  readonly head: number;
  readonly sites: readonly Site[];
};

type Verdict =
  | { readonly applies: "all"; readonly held: number; readonly overruns: readonly Site[]; readonly advisory: readonly Site[] }
  | { readonly applies: "ratchet"; readonly held: number; readonly growths: readonly Growth[]; readonly advisory: readonly Site[] };

class OxlintUnreadable extends Schema.TaggedError<OxlintUnreadable>()("OxlintUnreadable", {
  message: Schema.String,
}) {}

const NAME = "size-budget";
const USAGE = "usage: size-budget.ts <ref> | <base-ref> <head-ref>";
const DECLARATIONS = ":(exclude,glob)**/*.d.ts";
const TYPESCRIPT = [":(glob)**/*.ts", ":(glob)**/*.tsx", DECLARATIONS];
const TESTS = [`:(glob)${TESTS_DIRECTORY}/**/*.ts`, `:(glob)${TESTS_DIRECTORY}/**/*.tsx`];
const CONFIG = ".size-budget.oxlintrc.json";
const WHOLE_FILE: LimitKey = "fileLines";
const OXLINT_FOUND_NOTHING = 0;
const OXLINT_FOUND_ERRORS = 1;
const SCOPE = {
  ratchet: "the production and test files the range adds or changes",
  all: "every production and test file",
} satisfies Record<Applies, string>;

const Diagnostic = Schema.Struct({
  code: Schema.String,
  message: Schema.String,
  filename: Schema.String,
  labels: Schema.Array(Schema.Struct({ span: Schema.Struct({ line: Schema.Int }) })),
});

const decodeReport = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Struct({ diagnostics: Schema.Array(Diagnostic) })));

function rulesOf(budget: Budget): Record<string, unknown> {
  return Object.fromEntries(
    SIZE_RULES.map((entry) => {
      const max = budget[entry.key];
      return [qualifiedName(entry), max === undefined ? "off" : ["error", { max, ...entry.options }]];
    }),
  );
}

function sizeConfig({ production, tests }: Budgets, plugin: string): unknown {
  return {
    plugins: [],
    jsPlugins: [plugin],
    categories: { correctness: "off" },
    rules: rulesOf(production),
    overrides: [{ files: [`${TESTS_DIRECTORY}/**`], rules: rulesOf(tests) }],
  };
}

function heldByChange(changes: readonly Change[]): readonly Held[] {
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

const siteOf = (budgets: Budgets) =>
  Effect.fn("siteOf")(function* ({ code, message, filename, labels }: typeof Diagnostic.Type) {
    const rule = SIZE_RULES.find((candidate) => code === diagnosticCode(candidate));
    if (rule === undefined) return [];
    const measured = rule.measured.exec(message)?.[1];
    const max = budgetOf(budgets, filename)[rule.key];
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

const measure = Effect.fn("measure")(function* (tree: string, budgets: Budgets, plugin: string) {
  const fs = yield* FileSystem.FileSystem;
  if (!(yield* fs.exists(tree))) return [];
  // oxlint reads an override's glob from the directory of the config that holds it, so the config sits in the tree.
  yield* fs.writeFileString((yield* Path.Path).join(tree, CONFIG), renderJson(sizeConfig(budgets, plugin)));

  const { stdout, stderr, exitCode } = yield* collect("oxlint", ["-c", CONFIG, "-f", "json", "."], tree).pipe(
    Effect.mapError((cause) => new OxlintUnreadable({ message: `cannot run oxlint: ${cause.message}` })),
  );
  if (exitCode !== OXLINT_FOUND_NOTHING && exitCode !== OXLINT_FOUND_ERRORS) {
    return yield* new OxlintUnreadable({ message: `oxlint exited ${exitCode}: ${stderr.trim() || stdout.trim()}` });
  }
  const { diagnostics } = yield* decodeReport(stdout).pipe(
    Effect.mapError((cause) => new OxlintUnreadable({ message: `cannot read oxlint's report: ${cause.message}` })),
  );
  const sites = (yield* Effect.forEach(diagnostics, siteOf(budgets))).flat();
  return sites.toSorted((a, b) => a.file.localeCompare(b.file) || (a.line ?? 0) - (b.line ?? 0));
});

function byFileAndRule(sites: readonly Site[]): ReadonlyMap<string, readonly Site[]> {
  return Map.groupBy(sites, ({ file, rule }) => `${file}\0${rule}`);
}

function total(sites: readonly Site[]): number {
  return sites.reduce((sum, { overrun }) => sum + overrun, 0);
}

function growthsOf(head: readonly Site[], base: readonly Site[]): readonly Growth[] {
  const before = byFileAndRule(base);
  return [...byFileAndRule(head).entries()].flatMap(([group, sites]) => {
    const [first] = sites;
    const growth = { base: total(before.get(group) ?? []), head: total(sites), sites };
    return first !== undefined && growth.head > growth.base ? [{ file: first.file, rule: first.rule, ...growth }] : [];
  });
}

const heldFiles = Effect.fn("heldFiles")(function* (root: string, applies: Applies, pathspecs: readonly string[], base: string, head: string) {
  if (applies === "all") return (yield* pathsAt(head, pathspecs, root)).map((path): Held => ({ path, from: path }));
  return heldByChange(yield* changedPaths(base, head, pathspecs, root));
});

const runBudget = Effect.fn("runBudget")(
  function* (root: string, size: Size, production: readonly string[], base: string, head: string) {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const applies = size.applies ?? SIZE_DEFAULTS.applies;
    const budgets = budgetsOf(size);
    const pathspecs = [...production.map((glob) => `:(glob)${glob}`), ...TESTS, DECLARATIONS];
    const held = yield* heldFiles(root, applies, pathspecs, base, head);
    const holds = new Set(held.map((file) => file.path));
    const others = (yield* pathsAt(head, TYPESCRIPT, root)).filter((file) => !holds.has(file));
    const scratch = yield* fs.makeTempDirectoryScoped({ prefix: "checks-size-budget-" });

    const headTree = path.join(scratch, "head");
    if (held.length + others.length > 0) yield* materializeHead(root, head, [...holds, ...others], headTree);
    const plugin = path.join(import.meta.dir, "..", "dist", "index.js");
    const sites = yield* measure(headTree, budgets, plugin);
    const heldSites = sites.filter((site) => holds.has(site.file));
    if (applies !== "ratchet") {
      return { applies, held: held.length, overruns: heldSites, advisory: sites.filter((site) => !holds.has(site.file)) } satisfies Verdict;
    }

    const baseTree = path.join(scratch, "base");
    if (held.length > 0) yield* materializeBase(root, base, held, baseTree);
    const growths = growthsOf(heldSites, yield* measure(baseTree, budgets, plugin));
    const failing = new Set(growths.flatMap((growth) => growth.sites));
    return { applies, held: held.length, growths, advisory: sites.filter((site) => !failing.has(site)) } satisfies Verdict;
  },
  Effect.scoped,
);

function describe({ file, line, message }: Site, indent = "  "): string {
  return `${indent}${file}${line === undefined ? "" : `:${line}`}: ${message}`;
}

function verdictLines(verdict: Verdict): readonly string[] {
  const scope = SCOPE[verdict.applies];
  if (verdict.applies === "ratchet") {
    if (verdict.growths.length === 0) return [`${NAME}: ${verdict.held} file(s), ${scope}, raise no overrun past the base`];
    return [
      `${NAME}: ${verdict.growths.length} overrun(s) grew past the base in ${scope}:`,
      ...verdict.growths.flatMap(({ file, rule, base, head, sites }) => [
        `  ${file}: ${rule} over by ${head} in total, up from ${base}`,
        ...sites.map((site) => describe(site, "    ")),
      ]),
    ];
  }
  if (verdict.overruns.length === 0) return [`${NAME}: ${verdict.held} file(s), ${scope}, keep within the budget`];
  return [`${NAME}: ${verdict.overruns.length} overrun(s) of the budget in ${scope}:`, ...verdict.overruns.map((site) => describe(site))];
}

function report(verdict: Verdict): string {
  const { advisory } = verdict;
  const notice =
    advisory.length === 0
      ? []
      : [`${NAME}: advisory, ${advisory.length} overrun(s) where the budget does not hold yet:`, ...advisory.map((site) => describe(site))];
  return [...verdictLines(verdict), ...notice].join("\n");
}

function passes(verdict: Verdict): boolean {
  return verdict.applies === "ratchet" ? verdict.growths.length === 0 : verdict.overruns.length === 0;
}

const budget = Effect.gen(function* () {
  const { refs, root, source, quality } = yield* rangeGateInputs(USAGE);
  if (quality.size === undefined) {
    yield* Console.log(`${NAME}: ${source} declares no size budget`);
    return true;
  }
  const { base, head } = yield* rangeEnds(refs.first, refs.second, root);
  const verdict = yield* runBudget(root, quality.size, quality.sources?.production ?? [], base, head);

  yield* Console.log(report(verdict));
  return passes(verdict);
});

if (import.meta.main) runMain(NAME, budget);
