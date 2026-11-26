import { $ } from "bun";
import { expect, test } from "bun:test";
import { CHECKOUT, fixtureRepos, ran, scratchDirs, type FixtureRepo } from "../lib/fixture-repo.ts";

const open = fixtureRepos("checks-setup-typecheck-");
const scratch = scratchDirs();

const EFFECT_FAILURE = `import { Effect } from "effect";
export const fail = (cause: unknown) => Effect.fail(cause);
`;

const TAGGED_FAILURE = `import { Data, Effect } from "effect";
class Failure extends Data.TaggedError("Failure")<{ readonly cause: unknown }> {}
export const fail = (cause: unknown) => Effect.fail(new Failure({ cause }));
`;

const ASYNC_DECLARATION = "export async function later(): Promise<number> { return 1; }\n";

const UNKNOWN_ERROR = /index\.ts\(\d+,\d+\): error effect\(anyUnknownInErrorContext\)/;

const SOURCE_IMPORT_CONFIG = 'import { defineConfig } from "@avi2dg/checks/config";\nexport default defineConfig({});\n';

async function installKit(repo: FixtureRepo): Promise<void> {
  const dir = await scratch("checks-setup-pack-");
  const packed = await $`bun pm pack --destination ${dir} --quiet --ignore-scripts`.cwd(CHECKOUT).quiet();
  const tarball = packed.stdout.toString().trim();
  await $`bun pm pkg set ${`devDependencies.@avi2dg/checks=file:${tarball}`}`.cwd(repo.dir).quiet();
  await $`bun install --ignore-scripts`.cwd(repo.dir).quiet();
}

const typecheck = (repo: FixtureRepo) => ran($`bun run typecheck`.cwd(repo.dir));
const checkScope = (repo: FixtureRepo) => ran($`bun run checks-effect-scope --check`.cwd(repo.dir));

test("setup refuses a typecheck script that only echoes the checker names", async () => {
  const repo = await open({
    "package.json": JSON.stringify({ name: "consumer", scripts: { typecheck: "echo tsc effect-tsgo" } }),
    "index.ts": EFFECT_FAILURE,
  });
  const setup = await repo.script("delivery/setup.ts");
  expect(setup.text).toContain("scripts.typecheck must run tsc and the Effect diagnostics");
  expect(setup.exitCode).toBe(2);
}, 60_000);

test("a clean install from setup reaches Effect diagnostics instead of failing to resolve Bun types or the kit's source imports", async () => {
  const repo = await open({
    "index.ts": EFFECT_FAILURE,
  });
  expect(await repo.script("delivery/setup.ts")).toMatchObject({ exitCode: 0 });
  await installKit(repo);
  await repo.write({ "checks.config.ts": SOURCE_IMPORT_CONFIG });

  const checked = await typecheck(repo);
  expect(checked.text).toMatch(UNKNOWN_ERROR);
  expect(checked.text).not.toContain("TS5097");
  expect(checked.exitCode).toBe(1);

  await repo.write({ "index.ts": TAGGED_FAILURE });
  const corrected = await typecheck(repo);
  expect(corrected.text).not.toContain("TS5097");
  expect(corrected.exitCode).toBe(0);
}, 120_000);

test("setup does not drop shared Effect diagnostics when an unextended config has no scoped rules", async () => {
  const unextended = JSON.stringify({
    compilerOptions: { target: "esnext", module: "preserve", strict: true, noEmit: true, types: [] },
    include: ["index.ts"],
  });
  const repo = await open({
    "oxlint.config.ts": 'import { defineConfig } from "@avi2dg/checks/oxlint";\nexport default defineConfig({ effect: false });\n',
    "tsconfig.json": unextended,
    "index.ts": EFFECT_FAILURE + ASYNC_DECLARATION,
  });
  expect(await repo.script("delivery/setup.ts")).toMatchObject({ exitCode: 0 });
  await installKit(repo);

  expect((await checkScope(repo)).exitCode).toBe(0);
  const checked = await typecheck(repo);
  expect(checked.text).toMatch(UNKNOWN_ERROR);
  expect(checked.text).not.toContain("effect(asyncFunction)");
  expect(checked.exitCode).toBe(1);

  await repo.write({ "index.ts": TAGGED_FAILURE + ASYNC_DECLARATION });
  expect((await typecheck(repo)).exitCode).toBe(0);

  await repo.write({ "tsconfig.json": unextended });
  const stale = await checkScope(repo);
  expect(stale.text).toContain("run checks-effect-scope to rewrite them");
  expect(stale.exitCode).toBe(1);
}, 120_000);
