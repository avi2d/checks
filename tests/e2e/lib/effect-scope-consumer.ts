import { expect } from "bun:test";
import { realpathSync } from "node:fs";
import { readFile, symlink } from "node:fs/promises";
import { join } from "node:path";
import { consumerTrees, KIT_BIN, kitTree, type KitTree } from "./consumer-tree.ts";
import { findings } from "./findings.ts";
import { CHECKOUT, scratchDirs } from "./fixture-repo.ts";

export const SCOPED = "scripts/plant.ts";
export const BIN_PLANT = "scripts/bin.ts";
export const UNSCOPED = "tests/plant.ts";

export const SCOPE_OXLINT = [
  "node(no-sync)",
  "oxc(no-async-await)",
  "promise(avoid-new)",
  "unicorn(no-process-exit)",
  "effect-channel(no-throw)",
  "effect-channel(no-try-catch)",
];
export const PROCESS_EXIT = "eslint(no-restricted-properties)";
export const SCOPE_SERVICE = ["nodeBuiltinImport", "asyncFunction", "newPromise", "extendsNativeError", "processEnv", "processEnvInEffect"];
export const KIT_SERVICE = ["anyUnknownInErrorContext", "unsafeEffectTypeAssertion", "missingEffectError"];

export const PLANT = `import { Effect } from "effect";
import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";

export const text = readFileSync("plant.txt", "utf8");
export const child = spawn("git");
export async function later(): Promise<number> {
  return 1;
}
export const waited = new Promise<number>((resolve) => resolve(1));
export function stop(): void {
  process.exit(1);
}
export class Failure extends Error {}
export function fail(): never {
  throw new Failure();
}
export function guard(run: () => void): void {
  try {
    run();
  } catch {
    return;
  }
}
declare const failing: Effect.Effect<number, string>;
export const unknownFailure = (cause: unknown) => Effect.fail(cause);
export const narrowed = failing as Effect.Effect<number>;
export const missing: Effect.Effect<number> = failing;
export const home = process.env["HOME"];
export const homeInEffect = Effect.gen(function* () {
  return yield* Effect.succeed(process.env["HOME"]);
});
`;


const CLEAN: Readonly<Record<string, string>> = {
  [SCOPED]: `import { Effect } from "effect";\nexport const program = Effect.succeed(42);\n`,
  [UNSCOPED]: `export const answer = 42;\n`,
};

const OWN_OXLINT = [
  "oxlint.config.ts",
  "dist/presets/oxlint.js",
  "dist/effect-channel/index.js",
  "dist/readability/index.js",
  "dist/data-shape/index.js",
];

export const ASYNC_PLANT = `import { Effect } from "effect";
export async function later(): Promise<number> {
  return 1;
}
export const promised = new Promise<number>((resolve) => resolve(1));
export const shared = (cause: unknown): Effect.Effect<never, unknown> => Effect.fail(cause);
`;

export const ASYNC_RULE = "oxc(no-async-await)";
export const ASYNC_DIAGNOSTIC = "asyncFunction";


type Linted = {
  readonly exitCode: number;
  readonly linted: ReadonlyMap<string, readonly string[]>;
};

type ScopeConsumer = {
  readonly tree: KitTree;
  readonly consumer: () => Promise<void>;
  readonly ownOxlintConfig: () => Promise<void>;
  readonly plantViolations: () => Promise<void>;
  readonly plantClean: () => Promise<void>;
  readonly oxlint: (args?: readonly string[]) => Promise<Linted>;
  readonly diagnostics: () => Promise<ReadonlyMap<string, readonly string[]>>;
  readonly scopeGate: (...args: readonly string[]) => ReturnType<KitTree["run"]>;
  readonly expectAsyncPaths: (expected: readonly string[]) => Promise<void>;
};

export function scopeConsumer(prefix: string): ScopeConsumer {
  const consumerTree = consumerTrees(prefix);
  const scratch = scratchDirs();
  let current: KitTree;

  const tree: KitTree = {
    get dir() {
      return current.dir;
    },
    put: (file, content) => current.put(file, content),
    run: (program, args) => current.run(program, args),
  };

  async function consumer(): Promise<void> {
    current = await consumerTree({
      paths: ["scripts/**/*.ts"],
      include: ["scripts/**/*.ts", "tests/**/*.ts"],
      types: ["bun"],
    });
  }

  async function ownOxlintConfig(): Promise<void> {
    current = kitTree(await scratch("checks-effect-scope-own-"));
    await tree.put("package.json", { type: "module" });
    for (const config of OWN_OXLINT) await tree.put(config, await readFile(join(CHECKOUT, config), "utf8"));
    await symlink(join(CHECKOUT, "node_modules"), join(tree.dir, "node_modules"));
  }

  async function plantViolations(): Promise<void> {
    await tree.put(SCOPED, PLANT);
    await tree.put(UNSCOPED, PLANT);
  }

  async function plantClean(): Promise<void> {
    for (const [file, content] of Object.entries(CLEAN)) await tree.put(file, content);
  }

  async function oxlint(
    args: readonly string[] = ["--type-aware"],
  ): Promise<{ readonly exitCode: number; readonly linted: ReadonlyMap<string, readonly string[]> }> {
    const red = await tree.run(join(KIT_BIN, "oxlint"), [...args, "-f", "unix", "scripts", "tests"]);
    return { exitCode: red.exitCode, linted: findings(red.text, /^(\S+?):\d+:\d+: .*\[Error\/([^\]]+)\]$/gm) };
  }

  async function diagnostics(): Promise<ReadonlyMap<string, readonly string[]>> {
    const { text } = await tree.run(join(KIT_BIN, "effect-tsgo"), [
      "diagnostics",
      "--project",
      "tsconfig.json",
      "--format",
      "text",
      "--strict",
    ]);
    return findings(
      text.replaceAll(`${realpathSync(tree.dir)}/`, ""),
      /((?:scripts|tests)\/[^\s(]+\.ts)\(\d+,\d+\): error effect\((\w+)\)/g,
    );
  }

  function scopeGate(...args: readonly string[]) {
    return tree.run(process.execPath, [join(CHECKOUT, "src", "quality", "effect-scope.ts"), ...args]);
  }

  async function expectAsyncPaths(expected: readonly string[]): Promise<void> {
    const { linted } = await oxlint([]);
    const diagnosed = await diagnostics();
    const pathsWith = (report: ReadonlyMap<string, readonly string[]>, rule: string) =>
      [...report].filter(([, rules]) => rules.includes(rule)).map(([file]) => file).sort();
    expect(pathsWith(linted, ASYNC_RULE)).toEqual([...expected].sort());
    expect(pathsWith(diagnosed, ASYNC_DIAGNOSTIC)).toEqual(pathsWith(linted, ASYNC_RULE));
  }

  return { tree, consumer, ownOxlintConfig, plantViolations, plantClean, oxlint, diagnostics, scopeGate, expectAsyncPaths };
}
