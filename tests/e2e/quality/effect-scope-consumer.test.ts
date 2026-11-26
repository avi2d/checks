import { expect, test } from "bun:test";
import { realpathSync } from "node:fs";
import { readFile, symlink } from "node:fs/promises";
import { join } from "node:path";
import { consumerTrees, KIT_BIN, kitTree, type KitTree } from "../lib/consumer-tree.ts";
import { findings } from "../lib/findings.ts";
import { CHECKOUT, scratchDirs } from "../lib/fixture-repo.ts";

const SCOPED = "scripts/plant.ts";
const BIN_PLANT = "scripts/bin.ts";
const UNSCOPED = "tests/plant.ts";

const SCOPE_OXLINT = [
  "node(no-sync)",
  "oxc(no-async-await)",
  "promise(avoid-new)",
  "unicorn(no-process-exit)",
  "effect-channel(no-throw)",
  "effect-channel(no-try-catch)",
];
const PROCESS_EXIT = "eslint(no-restricted-properties)";
const SCOPE_SERVICE = ["nodeBuiltinImport", "asyncFunction", "newPromise", "extendsNativeError", "processEnv", "processEnvInEffect"];
const KIT_SERVICE = ["anyUnknownInErrorContext", "unsafeEffectTypeAssertion", "missingEffectError"];

const PLANT = `import { Effect } from "effect";
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

const consumerTree = consumerTrees("checks-effect-scope-consumer-");
const scratch = scratchDirs();

let tree: KitTree;

async function consumer(): Promise<void> {
  tree = await consumerTree({
    paths: ["scripts/**/*.ts"],
    include: ["scripts/**/*.ts", "tests/**/*.ts"],
    types: ["bun"],
  });
}

async function ownOxlintConfig(): Promise<void> {
  tree = kitTree(await scratch("checks-effect-scope-own-"));
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
    /((?:scripts|tests)\/[\w/]+\.ts)\(\d+,\d+\): error effect\((\w+)\)/g,
  );
}

test(
  "scope lint rules fail in the declared paths and tests/ stays green",
  async () => {
    await consumer();
    await plantViolations();
    const red = await oxlint();
    expect(red.exitCode).not.toBe(0);
    expect(red.linted.get(SCOPED)).toEqual(expect.arrayContaining(SCOPE_OXLINT));
    for (const rule of SCOPE_OXLINT) expect(red.linted.get(UNSCOPED) ?? []).not.toContain(rule);

    await plantClean();
    const green = await oxlint();
    expect(green.linted).toEqual(new Map());
    expect(green.exitCode).toBe(0);
  },
  180_000,
);

test(
  "scope diagnostics fail in the declared paths and the kit severities fail there and in tests/",
  async () => {
    await consumer();
    await plantViolations();
    const refused = await diagnostics();
    expect(refused.get(SCOPED)).toEqual(expect.arrayContaining([...SCOPE_SERVICE, ...KIT_SERVICE]));
    for (const rule of SCOPE_SERVICE) expect(refused.get(UNSCOPED) ?? []).not.toContain(rule);
    expect(refused.get(UNSCOPED)).toEqual(expect.arrayContaining(KIT_SERVICE));

    await plantClean();
    expect(await diagnostics()).toEqual(new Map());
  },
  180_000,
);

test(
  "generated config does not suggest recovery the oxlint base rejects",
  async () => {
    await consumer();
    const config = await Bun.file(join(tree.dir, "tsconfig.json")).json();
    const severity = config.compilerOptions.plugins[0].diagnosticSeverity;
    for (const rule of ["catchAllToMapError", "catchToIgnore", "catchToOrElseSucceed"]) {
      expect(severity[rule]).toBe("off");
    }

    await tree.put(SCOPED, `import { Effect } from "effect";
declare const input: Effect.Effect<void, string>;
export const ignored = Effect.ignore(input);
export const fallback = Effect.catch(input, () => Effect.succeed("fallback"));
`);
    const red = await oxlint();
    expect(red.linted.get(SCOPED)?.filter((rule) => rule === "effect-channel(no-error-channel-escape)")).toHaveLength(2);

    await tree.put(SCOPED, `import { Effect } from "effect";
declare const input: Effect.Effect<void, string>;
export const result = Effect.result(input);
export const recovered = Effect.catch(input, (error) => Effect.fail(error.length));
`);
    const green = await oxlint();
    expect(green.linted.get(SCOPED) ?? []).not.toContain("effect-channel(no-error-channel-escape)");
  },
  180_000,
);

test(
  "effect: true written through checks-effect-scope holds every source outside tests/ to the scope rules and diagnostics",
  async () => {
    await consumer();
    await tree.put("oxlint.config.ts", `import { defineConfig } from "@avi2dg/checks/oxlint";\n\nexport default defineConfig({ effect: true });\n`);
    expect((await tree.run(process.execPath, [join(CHECKOUT, "src", "quality", "effect-scope.ts")])).exitCode).toBe(0);
    await plantViolations();

    const red = await oxlint();
    expect(red.linted.get(SCOPED)).toEqual(expect.arrayContaining(SCOPE_OXLINT));
    for (const rule of SCOPE_OXLINT) expect(red.linted.get(UNSCOPED) ?? []).not.toContain(rule);
    const refused = await diagnostics();
    expect(refused.get(SCOPED)).toEqual(expect.arrayContaining(SCOPE_SERVICE));
    for (const rule of SCOPE_SERVICE) expect(refused.get(UNSCOPED) ?? []).not.toContain(rule);
  },
  180_000,
);

const ASYNC_PLANT = `import { Effect } from "effect";
export async function later(): Promise<number> {
  return 1;
}
export const promised = new Promise<number>((resolve) => resolve(1));
export const shared = (cause: unknown): Effect.Effect<never, unknown> => Effect.fail(cause);
`;

const ASYNC_RULE = "oxc(no-async-await)";
const ASYNC_DIAGNOSTIC = "asyncFunction";

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

test("scope generation does not certify async diagnostics that disagree with ordered oxlint overrides", async () => {
  await consumer();
  await tree.put("oxlint.config.ts", `import { defineConfig } from "@avi2dg/checks/oxlint";
const config = defineConfig({
  effect: { files: ["scripts/**/*.ts"], excludeFiles: ["scripts/excluded.ts"] },
  overrides: [
    { files: ["scripts/host/**"], excludeFiles: ["scripts/host/pass.ts"], rules: { "oxc/no-async-await": "off" } },
    { files: ["scripts/host/again.ts"], rules: { "oxc/no-async-await": ["error"] } },
  ],
});
export default {
  ...config,
  overrides: config.overrides.map((override) => override.rules?.["effect-channel/no-try-catch"] === "error"
    ? { ...override, rules: { ...Object.fromEntries(Object.entries(override.rules).reverse()), "eslint/no-debugger": "error" } }
    : override),
};
`);
  const positive = ["scripts/main.ts", "scripts/host/again.ts", "scripts/host/pass.ts"];
  for (const path of [...positive, "scripts/host/off.ts", "scripts/excluded.ts", UNSCOPED]) await tree.put(path, ASYNC_PLANT);
  const generated = await scopeGate();
  expect(generated.exitCode).toBe(0);
  expect((await scopeGate("--check")).exitCode).toBe(0);
  await expectAsyncPaths(positive);
  const diagnosed = await diagnostics();
  expect(diagnosed.get("scripts/host/off.ts")).toContain("newPromise");
  expect(diagnosed.get(UNSCOPED)).toContain("anyUnknownInErrorContext");
}, 180_000);

test("scope check does not certify brace or basename paths or paths ignored only by oxlint", async () => {
  const cases = [
    { scope: '{ files: ["scripts/{a,b}.ts"] }', extra: "", ignore: "", refused: "scripts/{a,b}.ts" },
    { scope: '{ files: ["scripts/**/*.ts"], excludeFiles: ["scripts/{a,b}.ts"] }', extra: "", ignore: "", refused: "scripts/{a,b}.ts" },
    { scope: '{ files: ["a.ts"] }', extra: "", ignore: "" },
    { scope: '{ files: ["scripts/**/*.ts"] }', extra: ', ignorePatterns: ["scripts/b.ts"]', ignore: "" },
    { scope: '{ files: ["scripts/**/*.ts"] }', extra: "", ignore: "scripts/b.ts\n" },
  ] as const;
  for (const entry of cases) {
    const { scope, extra, ignore } = entry;
    await consumer();
    await tree.put(".gitignore", "node_modules/\n" + ignore);
    expect((await tree.run("git", ["add", ".gitignore"])).exitCode).toBe(0);
    await tree.put("oxlint.config.ts", `import { defineConfig } from "@avi2dg/checks/oxlint";
export default defineConfig({ effect: ${scope}${extra} });
`);
    for (const path of ["scripts/a.ts", "scripts/b.ts", "scripts/nested/a.ts", UNSCOPED]) await tree.put(path, ASYNC_PLANT);
    const generated = await scopeGate();
    const checked = await scopeGate("--check");
    if ("refused" in entry) {
      for (const run of [generated, checked]) {
        expect(run.exitCode).toBe(2);
        expect(run.text).toContain(entry.refused);
        expect(run.text).toContain("use separate relative globs");
      }
    } else {
      expect(generated.exitCode).toBe(0);
      expect(checked.exitCode).toBe(0);
      await expectAsyncPaths(["scripts/a.ts", "scripts/nested/a.ts"]);
      expect((await diagnostics()).get("scripts/b.ts")).toContain("anyUnknownInErrorContext");
    }
  }
}, 180_000);

test("globstar and question mark include new matches without dropping ordinary excludes", async () => {
  await consumer();
  await tree.put("oxlint.config.ts", `import { defineConfig } from "@avi2dg/checks/oxlint";
export default defineConfig({ effect: { files: ["scripts/**/task?.ts"], excludeFiles: ["scripts/host/**"] } });
`);
  for (const path of ["scripts/task1.ts", "scripts/nested/task2.ts", "scripts/host/task3.ts", "scripts/task10.ts"]) {
    await tree.put(path, ASYNC_PLANT);
  }
  expect((await scopeGate()).exitCode).toBe(0);
  await tree.put("scripts/nested/task4.ts", ASYNC_PLANT);
  expect((await scopeGate("--check")).exitCode).toBe(0);
  await expectAsyncPaths(["scripts/task1.ts", "scripts/nested/task2.ts", "scripts/nested/task4.ts"]);
}, 180_000);

test("effect-free configs do not refuse irrelevant scope paths, categories, extends, or ignore files", async () => {
  for (const config of [
    'export default {};',
    'export default { ...defineConfig({ effect: false }), extends: ["other.json"], categories: { restriction: "deny" }, overrides: [{ files: ["scripts/{a,b}.ts"], rules: { "eslint/no-debugger": "error" } }] };',
  ]) {
    await consumer();
    await tree.put("oxlint.config.ts", `import { defineConfig } from "@avi2dg/checks/oxlint";\n${config}\n`);
    await tree.put(".gitignore", "node_modules/\n!.vscode/extensions.json\n");
    await tree.put(".eslintignore", "scripts/\n");
    await tree.put(".oxlintrc.json", "{}");
    await tree.put("scripts/oxlint.config.ts", "export default {};");
    expect((await scopeGate()).exitCode).toBe(0);
    expect((await scopeGate("--check")).exitCode).toBe(0);
    await tree.put(SCOPED, PLANT);
    const diagnosed = await diagnostics();
    for (const rule of SCOPE_SERVICE) expect(diagnosed.get(SCOPED) ?? []).not.toContain(rule);
    expect(diagnosed.get(SCOPED)).toEqual(expect.arrayContaining(KIT_SERVICE));
  }
}, 180_000);

test("allow and deny do not leave paired diagnostics at an earlier override severity", async () => {
  await consumer();
  await tree.put("oxlint.config.ts", `import { defineConfig } from "@avi2dg/checks/oxlint";
export default defineConfig({
  effect: false,
  rules: { "oxc/no-async-await": "deny" },
  overrides: [
    { files: ["scripts/host/**"], rules: { "oxc/no-async-await": ["allow"], "promise/avoid-new": "deny" } },
    { files: ["scripts/host/again.ts"], rules: { "oxc/no-async-await": "deny", "promise/avoid-new": "allow" } },
  ],
});
`);
  for (const file of ["scripts/a.ts", "scripts/host/off.ts", "scripts/host/again.ts"]) await tree.put(file, ASYNC_PLANT);
  expect((await scopeGate()).exitCode).toBe(0);
  expect((await scopeGate("--check")).exitCode).toBe(0);
  await expectAsyncPaths(["scripts/a.ts", "scripts/host/again.ts"]);
  const { linted } = await oxlint([]);
  const diagnosed = await diagnostics();
  for (const file of ["scripts/a.ts", "scripts/host/off.ts", "scripts/host/again.ts"]) {
    const expected = file === "scripts/host/off.ts";
    expect((linted.get(file) ?? []).includes("promise(avoid-new)")).toBe(expected);
    expect((diagnosed.get(file) ?? []).includes("newPromise")).toBe(expected);
  }
}, 180_000);

test("unsupported scoped severities and active categories cannot be certified as current", async () => {
  for (const extra of [
    'rules: { "oxc/no-async-await": "invalid" }',
    'overrides: [{ files: ["scripts/**"], rules: { "promise/avoid-new": [] } }]',
    'overrides: [{ files: ["scripts/**"], rules: { "node/no-sync": null } }]',
    'categories: { restriction: "deny" }',
    'categories: { style: "invalid" }',
  ]) {
    await consumer();
    await tree.put("oxlint.config.ts", `import { defineConfig } from "@avi2dg/checks/oxlint";
export default { ...defineConfig({ effect: true }), ${extra} };
`);
    for (const args of [[], ["--check"]]) expect((await scopeGate(...args)).exitCode).toBe(2);
  }
}, 180_000);

test("all six rules off does not leave unpaired diagnostics enabled or block later re-enabling", async () => {
  await consumer();
  await tree.put("oxlint.config.ts", `import { defineConfig, effectRules } from "@avi2dg/checks/oxlint";
const off = effectRules(["scripts/host/**"]);
export default defineConfig({
  effect: { files: ["scripts/**/*.ts"] },
  overrides: [
    { ...off, rules: Object.fromEntries(Object.keys(off.rules).map((rule) => [rule, "allow"])) },
    effectRules(["scripts/host/again.ts"]),
  ],
});
`);
  const active = ["scripts/a.ts", "scripts/host/again.ts"];
  for (const file of [...active, "scripts/host/off.ts", UNSCOPED]) await tree.put(file, PLANT);
  expect((await scopeGate()).exitCode).toBe(0);
  expect((await scopeGate("--check")).exitCode).toBe(0);
  await expectAsyncPaths(active);
  const diagnosed = await diagnostics();
  for (const file of active) expect(diagnosed.get(file)).toEqual(expect.arrayContaining(SCOPE_SERVICE));
  for (const file of ["scripts/host/off.ts", UNSCOPED]) {
    for (const rule of SCOPE_SERVICE) expect(diagnosed.get(file) ?? []).not.toContain(rule);
    expect(diagnosed.get(file)).toEqual(expect.arrayContaining(KIT_SERVICE));
  }
}, 180_000);

test("slash-less directory and wildcard ignores do not diagnose skipped files or swallow sibling names", async () => {
  for (const source of ["gitignore", "ignorePatterns"]) {
    await consumer();
    const ignores = ["scripts/generated", "coverage", "scripts/repos/*"];
    await tree.put(".gitignore", ["node_modules/", ...(source === "gitignore" ? ignores : [])].join("\n") + "\n");
    expect((await tree.run("git", ["add", ".gitignore"])).exitCode).toBe(0);
    await tree.put("oxlint.config.ts", `import { defineConfig } from "@avi2dg/checks/oxlint";
export default defineConfig({ effect: { files: ["scripts/**/*.ts"] }, ignorePatterns: ${JSON.stringify(source === "ignorePatterns" ? ignores : [])} });
`);
    const active = ["scripts/a.ts", "scripts/generatedFile.ts", "scripts/coverageFile.ts"];
    for (const file of [...active, "scripts/generated/client.ts", "scripts/coverage/plant.ts", "scripts/repos/vendor/client.ts"]) await tree.put(file, ASYNC_PLANT);
    expect((await scopeGate()).exitCode).toBe(0);
    await tree.put("scripts/generated/new.ts", ASYNC_PLANT);
    expect((await scopeGate("--check")).exitCode).toBe(0);
    await expectAsyncPaths(active);
  }
}, 180_000);

test("unrelated unsupported ignores pass without accepting a negation of a scoped TypeScript path", async () => {
  for (const source of ["gitignore", "ignorePatterns"]) {
    await consumer();
    const unrelated = [".vscode/*", "!.vscode/extensions.json", "*.py[cod]", "!outside/**"];
    const configure = async (patterns: readonly string[]) => {
      await tree.put(".gitignore", ["node_modules/", ...(source === "gitignore" ? patterns : [])].join("\n") + "\n");
      expect((await tree.run("git", ["add", ".gitignore"])).exitCode).toBe(0);
      await tree.put("oxlint.config.ts", `import { defineConfig } from "@avi2dg/checks/oxlint";
export default defineConfig({ effect: { files: ["scripts/**/*.ts"] }, ignorePatterns: ${JSON.stringify(source === "ignorePatterns" ? patterns : [])} });
`);
    };
    await configure(unrelated);
    await tree.put(SCOPED, ASYNC_PLANT);
    expect((await scopeGate()).exitCode).toBe(0);
    expect((await scopeGate("--check")).exitCode).toBe(0);
    await expectAsyncPaths([SCOPED]);
    for (const refused of ["!scripts/*.ts", "scripts/[ab]/*.cts", "scripts/\\*.tsx", "!keep/", "!scripts/vendor.lib", "!.vitepress"]) {
      await configure([...unrelated, refused]);
      for (const args of [[], ["--check"]]) {
        const result = await scopeGate(...args);
        expect(result.exitCode).toBe(2);
        expect(result.text).toContain(JSON.stringify(refused));
      }
    }
  }
}, 180_000);

test("clone-local ignores do not change committed scope while tracked nested ignores still apply", async () => {
  await consumer();
  await tree.put(".gitignore", "node_modules/\n");
  await tree.put("scripts/tracked/.gitignore", "ignored/\n");
  expect((await tree.run("git", ["add", ".gitignore", "scripts/tracked/.gitignore"])).exitCode).toBe(0);
  for (const file of [SCOPED, "scripts/local/a.ts", "scripts/untracked/a.ts", "scripts/tracked/ignored/a.ts"]) await tree.put(file, ASYNC_PLANT);
  expect((await scopeGate()).exitCode).toBe(0);
  const before = await readFile(join(tree.dir, "tsconfig.json"), "utf8");
  await tree.put(".git/info/exclude", "scripts/local/\n");
  await tree.put("scripts/untracked/.gitignore", "*\n");
  expect((await scopeGate("--check")).exitCode).toBe(0);
  expect((await scopeGate()).exitCode).toBe(0);
  expect(await readFile(join(tree.dir, "tsconfig.json"), "utf8")).toBe(before);
  const diagnosed = await diagnostics();
  for (const file of [SCOPED, "scripts/local/a.ts", "scripts/untracked/a.ts"]) expect(diagnosed.get(file)).toContain(ASYNC_DIAGNOSTIC);
  expect(diagnosed.get("scripts/tracked/ignored/a.ts") ?? []).not.toContain(ASYNC_DIAGNOSTIC);
}, 180_000);

test(
  "this checkout's own oxlint config fails a shebang bin on process.exit through the stand-in rule",
  async () => {
    await ownOxlintConfig();
    await tree.put(BIN_PLANT, "#!/usr/bin/env bun\nprocess.exit(1);\n");

    const red = await oxlint([]);
    expect(red.exitCode).not.toBe(0);
    expect(red.linted.get(BIN_PLANT)).toContain(PROCESS_EXIT);
    expect(red.linted.get(BIN_PLANT)).not.toContain("unicorn(no-process-exit)");

    await tree.put(BIN_PLANT, "#!/usr/bin/env bun\nexport const answer = 42;\n");
    const green = await oxlint([]);
    expect(green.linted).toEqual(new Map());
    expect(green.exitCode).toBe(0);
  },
  180_000,
);
