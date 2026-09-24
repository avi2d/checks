import { $ } from "bun";
import { afterEach, expect, test } from "bun:test";
import { copyFile, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const CHECKOUT = resolve(import.meta.dir, "..", "..");
const CONFIGS = [
  ".oxlintrc.json",
  "oxlintrc.json",
  "oxlintrc.quality.json",
  "dist/index.js",
  "tsconfig.json",
  "tsconfig.effect.json",
  "tsconfig.quality.json",
];

const PLANT = `import { Effect } from "effect";
import { readFileSync } from "node:fs";

export const text = readFileSync("plant.txt", "utf8");
export const waited = new Promise<number>((resolve) => resolve(1));
export class Failure extends Error {}
export async function later(): Promise<number> {
  return 1;
}
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
export function stop(): void {
  process.exit(1);
}
export const mapped = Effect.fail(1).pipe(Effect.catch((error) => Effect.fail(String(error))));
`;

const OXLINT_RULES = [
  "node(no-sync)",
  "oxc(no-async-await)",
  "promise(avoid-new)",
  "unicorn(no-process-exit)",
  "effect-channel(no-throw)",
  "effect-channel(no-try-catch)",
];
const PROCESS_EXIT = "eslint(no-restricted-properties)";
const SERVICE_RULES = ["nodeBuiltinImport", "asyncFunction", "newPromise", "extendsNativeError"];

let dir = "";

afterEach(async () => {
  if (dir !== "") {
    await rm(dir, { recursive: true, force: true });
    dir = "";
  }
});

async function plant(file: string, source: string): Promise<void> {
  await mkdir(dirname(join(dir, file)), { recursive: true });
  await writeFile(join(dir, file), source);
}

function findings(output: string, pattern: RegExp): ReadonlyMap<string, readonly string[]> {
  const found = new Map<string, string[]>();
  for (const [, file = "", rule = ""] of output.matchAll(pattern)) found.set(file, [...(found.get(file) ?? []), rule]);
  return found;
}

test(
  "scripts/ answers to the Effect rules of oxlint and the language service, and tests/ does not",
  async () => {
    dir = await mkdtemp(join(tmpdir(), "checks-effect-scope-"));
    for (const config of CONFIGS) {
      await mkdir(dirname(join(dir, config)), { recursive: true });
      await copyFile(join(CHECKOUT, config), join(dir, config));
    }
    await symlink(join(CHECKOUT, "node_modules"), join(dir, "node_modules"));
    await plant("scripts/plant.ts", PLANT);
    await plant("scripts/bin.ts", "#!/usr/bin/env bun\nprocess.exit(1);\n");
    await plant("tests/plant.ts", PLANT);

    const oxlint = await $`${join(dir, "node_modules", ".bin", "oxlint")} --type-aware -f unix scripts tests`
      .cwd(dir)
      .nothrow()
      .quiet();
    const linted = findings(oxlint.stdout.toString(), /^(\S+?):\d+:\d+: .*\[Error\/([^\]]+)\]$/gm);
    expect(linted.get("scripts/plant.ts")).toEqual(expect.arrayContaining([...OXLINT_RULES, PROCESS_EXIT]));
    expect(linted.get("scripts/bin.ts")).toContain(PROCESS_EXIT);
    expect(linted.get("scripts/bin.ts")).not.toContain("unicorn(no-process-exit)");
    for (const rule of OXLINT_RULES) expect(linted.get("tests/plant.ts") ?? []).not.toContain(rule);
    expect(linted.get("tests/plant.ts")).toContain(PROCESS_EXIT);

    const diagnostics = await $`${join(dir, "node_modules", ".bin", "effect-tsgo")} diagnostics --project tsconfig.json --format text --strict`
      .cwd(dir)
      .nothrow()
      .quiet();
    const refused = findings(diagnostics.stdout.toString(), /((?:scripts|tests)\/\w+\.ts)\(\d+,\d+\): error effect\((\w+)\)/g);
    expect(refused.get("scripts/plant.ts")).toEqual(expect.arrayContaining([...SERVICE_RULES, "catchAllToMapError"]));
    for (const rule of SERVICE_RULES) expect(refused.get("tests/plant.ts") ?? []).not.toContain(rule);
    // The fragment restates the plugin to add its overrides; the kit's severities must survive that.
    expect(refused.get("tests/plant.ts")).toContain("catchAllToMapError");
  },
  120_000,
);
