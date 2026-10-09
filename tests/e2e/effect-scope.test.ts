import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import severities from "../../src/quality/presets/effect.language-service.json" with { type: "json" };
import { CHECKOUT, fixtureRepos, type FixtureRepo } from "./lib/fixture-repo.ts";

const open = fixtureRepos("checks-effect-scope-");

const OXLINT_CONFIG = `import { defineConfig } from "${CHECKOUT}/dist/presets/oxlint.js";\n\nexport default defineConfig({ effect: { files: ["src/**/*.ts"] } });\n`;

const SERVICE = "@effect/language-service";

const OVERRIDES = [{ include: ["src/**/*.ts"], options: severities }];

const SEVERITY = `"diagnosticSeverity": { "floatingEffect": "error" }`;

const COMMENTED = `{
  // The kit's shared Effect diagnostics.
  "extends": ["@avi2dg/checks/tsconfig.effect.json"],
  "compilerOptions": {
    "strict": true, // stays strict
    "plugins": [
      {
        "name": "${SERVICE}",
        /* the repository's own severity */
        ${SEVERITY},
      },
    ],
  },
  "include": ["src/**/*.ts"],
}
`;

async function repository(tsconfig: string): Promise<FixtureRepo> {
  const repo = await open({ "package.json": JSON.stringify({ type: "module" }), "oxlint.config.ts": OXLINT_CONFIG, "tsconfig.json": tsconfig });
  await repo.commit("feat: tree");
  return repo;
}

const effectScope = (repo: FixtureRepo, ...args: readonly string[]) => repo.script("quality/effect-scope.ts", ...args);

const tsconfigOf = (repo: FixtureRepo) => readFile(join(repo.dir, "tsconfig.json"), "utf8");

test("a tsconfig.json with comments and trailing commas gains the Effect paths and keeps every other byte", async () => {
  const repo = await repository(COMMENTED);
  const stale = await effectScope(repo, "--check");
  expect(stale.text).toContain("run checks-effect-scope to rewrite them");
  expect(stale.exitCode).toBe(1);

  expect((await effectScope(repo)).exitCode).toBe(0);
  const written = await tsconfigOf(repo);
  const insertedAt = COMMENTED.indexOf(SEVERITY) + SEVERITY.length;
  expect(written.startsWith(COMMENTED.slice(0, insertedAt))).toBe(true);
  expect(written.endsWith(COMMENTED.slice(insertedAt))).toBe(true);
  expect(Bun.JSONC.parse(written)).toEqual({
    extends: ["@avi2dg/checks/tsconfig.effect.json"],
    compilerOptions: { strict: true, plugins: [{ name: SERVICE, diagnosticSeverity: { floatingEffect: "error" }, overrides: OVERRIDES }] },
    include: ["src/**/*.ts"],
  });

  const fresh = await effectScope(repo, "--check");
  expect(fresh.text).toContain("tsconfig.json holds the Effect paths of oxlint.config.ts");
  expect(fresh.exitCode).toBe(0);
  expect((await effectScope(repo)).exitCode).toBe(0);
  expect(await tsconfigOf(repo)).toBe(written);
}, 60_000);

test("the Effect paths written ahead of the plugin's other keys already hold, and nothing is rewritten", async () => {
  const tsconfig = `${JSON.stringify({ compilerOptions: { plugins: [{ name: SERVICE, overrides: OVERRIDES, diagnosticSeverity: { floatingEffect: "error" } }] } }, null, 2)}\n`;
  const repo = await repository(tsconfig);
  const held = await effectScope(repo, "--check");
  expect(held.text).toContain("tsconfig.json holds the Effect paths of oxlint.config.ts");
  expect(held.exitCode).toBe(0);
  expect((await effectScope(repo)).exitCode).toBe(0);
  expect(await tsconfigOf(repo)).toBe(tsconfig);
}, 60_000);

test("a tsconfig.json that does not parse as JSONC leaves the gate undecided", async () => {
  const repo = await repository(`{ "compilerOptions": { /* unterminated }\n`);
  const undecided = await effectScope(repo, "--check");
  expect(undecided.text).toContain("tsconfig.json does not parse as a JSONC object");
  expect(undecided.exitCode).toBe(2);
}, 60_000);

test("a compilerOptions or plugins set to null leaves the gate undecided rather than passing without the Effect paths", async () => {
  const refusals: Readonly<Record<string, string>> = {
    [`{ "compilerOptions": null }\n`]: "tsconfig.json holds compilerOptions that is not an object",
    [`{ "compilerOptions": { "plugins": null } }\n`]: "tsconfig.json holds compilerOptions.plugins that is not a list of objects",
  };
  for (const [tsconfig, refusal] of Object.entries(refusals)) {
    const repo = await repository(tsconfig);
    for (const args of [[], ["--check"]]) {
      const undecided = await effectScope(repo, ...args);
      expect(undecided.text).toContain(refusal);
      expect(undecided.exitCode).toBe(2);
    }
    expect(await tsconfigOf(repo)).toBe(tsconfig);
  }
}, 60_000);
