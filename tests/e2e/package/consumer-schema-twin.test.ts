import { $ } from "bun";
import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CHECKOUT, ran, type Ran } from "../lib/fixture-repo.ts";

const KEPT_ACROSS_TESTS = new Set(["node_modules", "bun.lock"]);

let dir = "";
let fileDir = "";

function manifestFor(checks: string): Record<string, unknown> {
  return {
    name: "checks-consumer-fixture",
    type: "module",
    author: "avi2d <avi2dg@gmail.com>",
    devDependencies: {
      "@avi2dg/checks": checks,
      effect: "4.0.0",
      oxlint: "1.83.0",
      "@swc/core": "1.16.2",
      "@types/bun": "1.4.2",
    },
  };
}

async function installConsumer(installDir: string, checks: string): Promise<void> {
  await writeFile(join(installDir, "package.json"), JSON.stringify(manifestFor(checks)));
  await $`bun install`.cwd(installDir).quiet();
}

async function resetWorkspace(workDir: string): Promise<void> {
  for (const entry of await readdir(workDir)) {
    if (KEPT_ACROSS_TESTS.has(entry)) continue;
    await rm(join(workDir, entry), { recursive: true, force: true });
  }
}

beforeAll(async () => {
  fileDir = await mkdtemp(join(tmpdir(), "checks-consumer-schema-twin-"));
  await installConsumer(fileDir, `file:${CHECKOUT}`);
}, 360_000);

afterAll(async () => {
  if (fileDir) await rm(fileDir, { recursive: true, force: true });
}, 60_000);

function oxlint(): Promise<Ran> {
  const binary = join(dir, "node_modules", ".bin", "oxlint");
  return ran($`${binary} --type-aware`.cwd(dir));
}

async function useConsumer(): Promise<void> {
  dir = fileDir;
  await resetWorkspace(dir);
  await writeFile(join(dir, "package.json"), JSON.stringify(manifestFor(`file:${CHECKOUT}`)));
  await writeFile(
    join(dir, ".oxlintrc.json"),
    JSON.stringify({
      extends: ["./node_modules/@avi2dg/checks/oxlintrc.json"],
      plugins: ["typescript", "oxc", "eslint", "import"],
    }),
  );
  await writeFile(join(dir, ".gitignore"), "node_modules/\n");
}

test(
  "file: consumer goes red on a mutable collection parameter and a schema twin, a twin under tests/ included, green once each is fixed",
  async () => {
    await useConsumer();
    await writeFile(join(dir, "totals.ts"), `export function total(items: string[]): number {\n  return items.length;\n}\n`);
    await writeFile(join(dir, "status.ts"), `import { Schema } from "effect";\nexport type Status = { readonly code: string; readonly count: number };\nexport const StatusSchema = Schema.Struct({ code: Schema.String, count: Schema.Number });\n`);
    await mkdir(join(dir, "tests"));
    await writeFile(join(dir, "tests", "oracle.ts"), `import { Schema } from "effect";\nexport type Oracle = { readonly code: string; readonly count: number };\nexport const OracleSchema = Schema.Struct({ code: Schema.String, count: Schema.Number });\n`);
    const red = await oxlint();
    expect(red.text).toContain("data-shape(readonly-collection-param)");
    expect(red.text).toContain("data-shape(schema-twin)");
    expect(red.text).toContain("status.ts");
    expect(red.text).toContain("tests/oracle.ts");
    await writeFile(join(dir, "totals.ts"), `export function total(items: readonly string[]): number {\n  return items.length;\n}\n`);
    await writeFile(join(dir, "status.ts"), `import { Schema } from "effect";\nexport const StatusSchema = Schema.Struct({ code: Schema.String, count: Schema.Number });\nexport type Status = typeof StatusSchema.Type;\n`);
    await writeFile(join(dir, "tests", "oracle.ts"), `import { Schema } from "effect";\nexport const OracleSchema = Schema.Struct({ code: Schema.String, count: Schema.Number });\nexport type Oracle = typeof OracleSchema.Type;\n`);
    expect((await oxlint()).exitCode).toBe(0);
  },
  180_000,
);
