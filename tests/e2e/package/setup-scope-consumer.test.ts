import { $ } from "bun";
import { expect, test } from "bun:test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Schema } from "effect";
import { consumerManifest, installPackedConsumer, resetConsumer } from "../lib/consumer-install.ts";
import { ASYNC_DIAGNOSTIC, ASYNC_PLANT, ASYNC_RULE, SCOPE_SERVICE } from "../lib/effect-scope-consumer.ts";
import { findings } from "../lib/findings.ts";
import { CHECKOUT, ran, scratchDirs } from "../lib/fixture-repo.ts";

const scratch = scratchDirs();
const HOST = "src/host.ts";
const TEST = "src/scope.test.ts";
const SEED = '{\n  "compilerOptions": { "strict": true },\n  "include": ["src/**/*.ts"],\n}\n';
const SETUP_SCOPE_CASES = [
  {
    config: '{ effect: { files: ["src/**/*.ts"] }, overrides: [{ files: ["src/host.ts"], rules: { "oxc/no-async-await": "off" } }] }',
    active: [TEST],
  },
  {
    config: '{ effect: { files: ["src/**/*.ts"], excludeFiles: [] } }',
    active: [HOST, TEST],
  },
  {
    config: "{ effect: useEffect }",
    active: [],
  },
];

const decodeTsconfig = Schema.decodeUnknownSync(Schema.Struct({
  compilerOptions: Schema.Struct({
    strict: Schema.Boolean,
    plugins: Schema.Array(Schema.Struct({
      name: Schema.String,
      diagnosticSeverity: Schema.Record(Schema.String, Schema.Unknown),
      overrides: Schema.optionalKey(Schema.Unknown),
    })),
  }),
}));

const runBin = (dir: string, bin: string, ...args: readonly string[]) =>
  ran($`${join(dir, "node_modules", ".bin", bin)} ${args}`.cwd(dir));

async function expectWrite(dir: string, bin: "checks-setup" | "checks-effect-scope", written: string): Promise<void> {
  expect(await runBin(dir, bin)).toMatchObject({ exitCode: 0 });
  expect(await readFile(join(dir, "tsconfig.json"), "utf8")).toBe(written);
}

function pathsWith(report: ReadonlyMap<string, readonly string[]>, rule: string): readonly string[] {
  return [...report].filter(([, rules]) => rules.includes(rule)).map(([file]) => file).sort();
}

async function compareWithOxlint(dir: string, expected: readonly string[]): Promise<void> {
  const lint = await runBin(dir, "oxlint", "--format=unix", "src");
  const tsgo = await runBin(dir, "effect-tsgo", "diagnostics", "--project", "tsconfig.json", "--format", "text", "--strict");
  expect(lint.exitCode).toBe(expected.length === 0 ? 0 : 1);
  const linted = findings(lint.text, /^(src\/[^:]+):\d+:\d+: .*\[Error\/([^\]]+)\]$/gm);
  const diagnosed = findings(tsgo.text, /(src\/[^\s(]+\.ts)\(\d+,\d+\): error effect\((\w+)\)/g);
  expect(pathsWith(linted, ASYNC_RULE)).toEqual(expected);
  expect(pathsWith(diagnosed, ASYNC_DIAGNOSTIC)).toEqual(expected);
  expect(pathsWith(diagnosed, "anyUnknownInErrorContext")).toEqual([HOST, TEST]);
}

async function expectScope(dir: string, config: string, expected: readonly string[]): Promise<void> {
  await $`git init -q`.cwd(dir).quiet();
  await writeFile(join(dir, "oxlint.config.ts"), `import { defineConfig } from "@avi2dg/checks/oxlint";
const useEffect = false;
export default defineConfig(${config});
`);
  await mkdir(join(dir, "src"));
  for (const file of [HOST, TEST]) await writeFile(join(dir, file), ASYNC_PLANT);
  const tsconfig = join(dir, "tsconfig.json");
  await writeFile(tsconfig, SEED);
  expect(await runBin(dir, "checks-setup")).toMatchObject({ exitCode: 0 });
  expect(await runBin(dir, "checks-effect-scope", "--check")).toMatchObject({ exitCode: 0 });
  const written = await readFile(tsconfig, "utf8");
  const { compilerOptions } = decodeTsconfig(Bun.JSONC.parse(written));
  expect(compilerOptions.strict).toBe(true);
  if (expected.length === 0) {
    const plugin = compilerOptions.plugins.find(({ name }) => name === "@effect/language-service");
    expect(plugin).toBeDefined();
    expect(plugin?.overrides).toBeUndefined();
    for (const rule of SCOPE_SERVICE) expect(plugin?.diagnosticSeverity).not.toHaveProperty(rule);
  }
  await compareWithOxlint(dir, expected);
  await expectWrite(dir, "checks-setup", written);
  await writeFile(tsconfig, SEED);
  await expectWrite(dir, "checks-effect-scope", written);
  await expectWrite(dir, "checks-effect-scope", written);
}

test("installed setup and generation do not write stale scope for overlap, empty exclusions, or computed false", async () => {
  const dir = await scratch("checks-setup-scope-consumer-");
  const tarball = await installPackedConsumer(CHECKOUT, await scratch("checks-setup-scope-pack-"), dir);
  for (const { config, active } of SETUP_SCOPE_CASES) {
    await resetConsumer(dir);
    await writeFile(join(dir, "package.json"), JSON.stringify(consumerManifest(`file:${tarball}`)));
    await expectScope(dir, config, active);
  }
}, 180_000);
