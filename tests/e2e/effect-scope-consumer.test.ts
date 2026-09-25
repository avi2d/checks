import { $ } from "bun";
import { expect, test } from "bun:test";
import { realpathSync } from "node:fs";
import { copyFile, mkdir, readdir, symlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { OXLINT_FRAGMENT, TSCONFIG_FRAGMENT } from "../../scripts/quality.ts";
import { withoutPullRequestEvent } from "../lib/env.ts";
import { findings } from "./lib/findings.ts";
import { CHECKOUT, ran, scratchDirs, type Ran } from "./lib/fixture-repo.ts";

const QUALITY = join(CHECKOUT, "scripts", "quality.ts");
const BIN = join(CHECKOUT, "node_modules", ".bin");

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
const SCOPE_SERVICE = ["nodeBuiltinImport", "asyncFunction", "newPromise", "extendsNativeError"];
const KIT_SERVICE = ["anyUnknownInErrorContext", "unsafeEffectTypeAssertion", "catchAllToMapError", "missingEffectError"];

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
export const remapped = failing.pipe(Effect.catch((error) => Effect.fail(error.length)));
export const missing: Effect.Effect<number> = failing;
`;

const CLEAN: Readonly<Record<string, string>> = {
  [SCOPED]: `import { Effect } from "effect";\nexport const program = Effect.succeed(42);\n`,
  [UNSCOPED]: `export const answer = 42;\n`,
};

const OWN_OXLINT = [".oxlintrc.json", "oxlintrc.json", "oxlintrc.quality.json", "dist/index.js"];

const scratch = scratchDirs();

let dir = "";

async function put(file: string, content: string): Promise<void> {
  await mkdir(dirname(join(dir, file)), { recursive: true });
  await writeFile(join(dir, file), content);
}

async function consumer(): Promise<void> {
  dir = await scratch("checks-effect-scope-consumer-");
  await mkdir(join(dir, "node_modules", "@avi2dg"), { recursive: true });
  for (const entry of await readdir(join(CHECKOUT, "node_modules"))) {
    await symlink(join(CHECKOUT, "node_modules", entry), join(dir, "node_modules", entry));
  }
  await symlink(CHECKOUT, join(dir, "node_modules", "@avi2dg", "checks"));
  await put(".gitignore", "node_modules/\n");
  await put(
    "quality.json",
    JSON.stringify({
      $schema: "./node_modules/@avi2dg/checks/quality.schema.json",
      sources: { effect: { paths: ["scripts/**/*.ts"] } },
    }),
  );
  await put(
    ".oxlintrc.json",
    JSON.stringify({
      extends: ["./node_modules/@avi2dg/checks/oxlintrc.json", `./${OXLINT_FRAGMENT}`],
      plugins: ["typescript", "oxc", "eslint", "import"],
    }),
  );
  await put(
    "tsconfig.json",
    JSON.stringify({
      extends: ["@avi2dg/checks/tsconfig.effect.json", `./${TSCONFIG_FRAGMENT}`],
      compilerOptions: { target: "esnext", module: "preserve", moduleResolution: "bundler", strict: true, noEmit: true, types: ["bun"] },
      include: ["scripts/**/*.ts", "tests/**/*.ts"],
    }),
  );
  await $`git init -q -b main`.cwd(dir).quiet();
}

async function ownOxlintConfig(): Promise<void> {
  dir = await scratch("checks-effect-scope-own-");
  for (const config of OWN_OXLINT) {
    await mkdir(dirname(join(dir, config)), { recursive: true });
    await copyFile(join(CHECKOUT, config), join(dir, config));
  }
  await symlink(join(CHECKOUT, "node_modules"), join(dir, "node_modules"));
}

function run(program: string, args: readonly string[]): Promise<Ran> {
  return ran($`${program} ${args}`.cwd(dir).env({ ...withoutPullRequestEvent(), PATH: `${BIN}:${process.env["PATH"] ?? ""}` }));
}

async function plantViolations(): Promise<void> {
  await put(SCOPED, PLANT);
  await put(UNSCOPED, PLANT);
}

async function plantClean(): Promise<void> {
  for (const [file, content] of Object.entries(CLEAN)) await put(file, content);
}

async function oxlint(
  args: readonly string[] = ["--type-aware"],
): Promise<{ readonly exitCode: number; readonly linted: ReadonlyMap<string, readonly string[]> }> {
  const red = await run(join(BIN, "oxlint"), [...args, "-f", "unix", "scripts", "tests"]);
  return { exitCode: red.exitCode, linted: findings(red.text, /^(\S+?):\d+:\d+: .*\[Error\/([^\]]+)\]$/gm) };
}

async function diagnostics(): Promise<ReadonlyMap<string, readonly string[]>> {
  const { text } = await run(join(BIN, "effect-tsgo"), [
    "diagnostics",
    "--project",
    "tsconfig.json",
    "--format",
    "text",
    "--strict",
  ]);
  return findings(
    text.replaceAll(`${realpathSync(dir)}/`, ""),
    /((?:scripts|tests)\/[\w/]+\.ts)\(\d+,\d+\): (?:error|warning) effect\((\w+)\)/g,
  );
}

test(
  "scope lint rules fail in the declared paths and tests/ stays green",
  async () => {
    await consumer();
    await plantViolations();
    expect((await run("bun", [QUALITY, "generate"])).exitCode).toBe(0);

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
    expect((await run("bun", [QUALITY, "generate"])).exitCode).toBe(0);

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
  "this checkout's own oxlint config fails a shebang bin on process.exit through the stand-in rule",
  async () => {
    await ownOxlintConfig();
    await put(BIN_PLANT, "#!/usr/bin/env bun\nprocess.exit(1);\n");

    const red = await oxlint([]);
    expect(red.exitCode).not.toBe(0);
    expect(red.linted.get(BIN_PLANT)).toContain(PROCESS_EXIT);
    expect(red.linted.get(BIN_PLANT)).not.toContain("unicorn(no-process-exit)");

    await put(BIN_PLANT, "#!/usr/bin/env bun\nexport const answer = 42;\n");
    const green = await oxlint([]);
    expect(green.linted).toEqual(new Map());
    expect(green.exitCode).toBe(0);
  },
  180_000,
);
