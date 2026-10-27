#!/usr/bin/env bun
import { Console, Effect } from "effect";
import { changedPaths, git } from "./git.ts";
import { KIT_GATES } from "./gates.ts";
import { runMain, Usage } from "./main.ts";

const NAME = "scope";
const USAGE = "usage: scope.ts [<base-ref> <head-ref>]";

export type Scope = {
  readonly full: boolean;
  readonly gates: readonly string[];
};

export type ChangeShape =
  | "docs"
  | "copy"
  | "typescript"
  | "test"
  | "workflow"
  | "lockfile"
  | "unknown";

const TREE_GATES = KIT_GATES.filter((gate) => gate.reads === "tree").map((gate) => gate.bin);

// checks-unused and checks-imports each take over a second, so the desk run skips them.
const SLOW_TREE_GATES: readonly string[] = ["checks-unused", "checks-imports"];

export const FAST_TREE_GATES: readonly string[] = TREE_GATES.filter((bin) => !SLOW_TREE_GATES.includes(bin));

const AGENT_FILES = new Set(["AGENTS.md", "CLAUDE.md"]);
const CI_CONFIGS = new Set([
  "package.json",
  "bunfig.toml",
  "commitlint.config.ts",
  "oxlint.config.ts",
  "knip.config.ts",
  "knip-base.json",
  "dependency-cruiser.config.js",
  "dependency-cruiser.config.ts",
]);
const basenameOf = (path: string): string => path.slice(path.lastIndexOf("/") + 1);

export function classifyPath(path: string): ChangeShape {
  const basename = basenameOf(path);
  if (basename === "bun.lock") return "lockfile";
  if (path.startsWith(".github/") || CI_CONFIGS.has(basename) || /^tsconfig(\..*)?\.json$/.test(basename)) {
    return "workflow";
  }
  if (path.startsWith("tests/") && /\.test\.tsx?$/.test(path)) return "test";
  if (basename === "copy.json") return "copy";
  if (/\.(?:ts|tsx|mts|cts|astro)$/.test(path)) return "typescript";
  const lower = basename.toLowerCase();
  if (lower.endsWith(".md") || AGENT_FILES.has(basename)) return "docs";
  return "unknown";
}

const fullScope = (): Scope => ({ full: true, gates: KIT_GATES.map((gate) => gate.bin) });

export function selectScope(paths: readonly string[]): Scope {
  if (paths.length === 0) return fullScope();
  const shapes = new Set(paths.map(classifyPath));
  if (shapes.has("unknown") || shapes.has("workflow") || shapes.has("lockfile")) return fullScope();
  const copyContent = shapes.has("copy") || paths.some((path) => path.endsWith(".md") || path.endsWith(".html"));
  const tree = shapes.has("typescript")
    ? TREE_GATES
    : [...(copyContent ? ["checks-copy"] : []), ...(shapes.has("test") ? ["checks-test-layout"] : [])];
  return {
    full: false,
    gates: KIT_GATES.filter((gate) => gate.reads === "range" || tree.includes(gate.bin)).map((gate) => gate.bin),
  };
}

const reportScope = Effect.fn("reportScope")(function* (base: string, head: string) {
  const mergeBase = (yield* git(["merge-base", base, head])).trim();
  const changes = yield* changedPaths(mergeBase, head, []);
  return selectScope(changes.flatMap((change) => (change.kind === "renamed" ? [change.from, change.path] : [change.path])));
});

const report = (scope: Scope): string => "full=" + scope.full;

const scopeEntry = Effect.gen(function* () {
  const [base, head, ...extra] = process.argv.slice(2);
  if (extra.length > 0 || base === "" || head === "") return yield* new Usage({ message: USAGE });
  if (base === undefined || head === undefined) {
    yield* Console.log(report(fullScope()));
    return true;
  }
  yield* Console.log(report(yield* reportScope(base, head)));
  return true;
});

if (import.meta.main) runMain(NAME, scopeEntry);
