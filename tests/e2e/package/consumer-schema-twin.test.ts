import { $ } from "bun";
import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installConsumer } from "../lib/consumer-install.ts";
import { CHECKOUT, ran, type Ran } from "../lib/fixture-repo.ts";

let dir = "";

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "checks-consumer-schema-twin-"));
  await installConsumer(dir, `file:${CHECKOUT}`);
  await writeFile(
    join(dir, ".oxlintrc.json"),
    JSON.stringify({
      extends: ["./node_modules/@avi2dg/checks/oxlintrc.json"],
      plugins: ["typescript", "oxc", "eslint", "import"],
    }),
  );
  await writeFile(join(dir, ".gitignore"), "node_modules/\n");
}, 360_000);

afterAll(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
}, 60_000);

function oxlint(): Promise<Ran> {
  const binary = join(dir, "node_modules", ".bin", "oxlint");
  return ran($`${binary} --type-aware`.cwd(dir));
}

test(
  "file: consumer goes red on a mutable collection parameter and a schema twin, a twin under tests/ included, green once each is fixed",
  async () => {
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
