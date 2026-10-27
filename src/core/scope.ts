import { KIT_GATES } from "./gates.ts";

export type Scope = {
  readonly full: boolean;
  readonly gates: readonly string[];
};

export type ChangeShape = "docs" | "copy" | "typescript" | "workflow" | "lockfile" | "unknown";

const TREE_GATES = KIT_GATES.filter((gate) => gate.reads === "tree").map((gate) => gate.bin);

// checks-unused and checks-imports each take over a second, so the desk run skips them.
const SLOW_TREE_GATES: readonly string[] = ["checks-unused", "checks-imports"];

export const FAST_TREE_GATES: readonly string[] = TREE_GATES.filter((bin) => !SLOW_TREE_GATES.includes(bin));

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
  if (path === "copy.json") return "copy";
  if (/\.(?:ts|tsx|mts|cts|astro)$/.test(path)) return "typescript";
  if (path.endsWith(".md")) return "docs";
  return "unknown";
}

const fullScope = (): Scope => ({ full: true, gates: KIT_GATES.map((gate) => gate.bin) });

export function selectScope(paths: readonly string[]): Scope {
  if (paths.length === 0) return fullScope();
  const shapes = new Set(paths.map(classifyPath));
  if (shapes.has("unknown") || shapes.has("workflow") || shapes.has("lockfile")) return fullScope();
  const copyContent = shapes.has("copy") || shapes.has("docs");
  const tree = shapes.has("typescript") ? TREE_GATES : copyContent ? ["checks-copy"] : [];
  return {
    full: false,
    gates: KIT_GATES.filter((gate) => gate.reads === "range" || tree.includes(gate.bin)).map((gate) => gate.bin),
  };
}

