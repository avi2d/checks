import { $ } from "bun";
import { expect, test } from "bun:test";
import { mkdir, rename, symlink } from "node:fs/promises";
import { join } from "node:path";
import { CHECKOUT, ran, scratchDirs, type FixtureRepo } from "./lib/fixture-repo.ts";
import { committedRepos, runStep, scopeOf } from "./lib/mutation-scope.ts";

const repoWith = committedRepos("checks-mutation-scope-stryker-");
const scratch = scratchDirs();

type HeadReport = { readonly files: Readonly<Record<string, { readonly mutants: ReadonlyArray<{ readonly replacement: string; readonly status: string }> }>> };

const readReport = (repo: FixtureRepo): Promise<HeadReport> => Bun.file(join(repo.dir, "reports", "mutation", "mutation.json")).json();

async function strykerRepo(testFile: string, files: Readonly<Record<string, string>>, mutate?: readonly string[]): Promise<{ repo: FixtureRepo; base: string }> {
  const { repo, base } = await repoWith({
    ".gitignore": "node_modules\nreports\n.stryker-tmp\n",
    "package.json": '{"name":"stryker-fixture","type":"module","private":true}\n',
    "stryker.conf.mjs": `export default ${JSON.stringify({
      plugins: ["@stryker-mutator/*", "@hughescr/stryker-bun-runner"],
      testRunner: "bun",
      coverageAnalysis: "perTest",
      reporters: ["json"],
      ...(mutate === undefined ? {} : { mutate }),
      bun: { testFiles: [testFile] },
      concurrency: 1,
    })};\n`,
    ...files,
  });
  await symlink(join(CHECKOUT, "node_modules"), join(repo.dir, "node_modules"));
  return { repo, base };
}

const names = (input: readonly string[]): string => `${JSON.stringify({ input, expected: ["ab"] })}\n`;

test("the head run retests a mutant whose killing test reads a fixture the pull request weakens", async () => {
  const { repo, base } = await strykerRepo("tests/unit/kept.test.ts", {
    "src/kept.ts": 'export const kept = (names: string[]) => names.filter((name) => name.startsWith("a"));\n',
    "tests/fixtures/kept/names.json": names(["ab", "cd"]),
    "tests/unit/kept.test.ts": [
      'import { expect, test } from "bun:test";',
      'import { join } from "node:path";',
      'import { kept } from "../../src/kept.ts";',
      "",
      'const names = await Bun.file(join(import.meta.dir, "..", "fixtures", "kept", "names.json")).json();',
      "",
      'test("kept names start with a", () => {',
      "  expect(kept(names.input)).toEqual(names.expected);",
      "});",
      "",
    ].join("\n"),
  });
  const stryker = $`bunx stryker run --incremental --ignoreStatic --mutate src/kept.ts`.cwd(repo.dir);
  expect((await ran(stryker)).exitCode).toBe(0);
  const runnerTemp = await scratch("checks-mutation-runner-");
  await mkdir(join(runnerTemp, "mutation-base"));
  await rename(join(repo.dir, "reports"), join(runnerTemp, "mutation-base", "reports"));
  const baseline = join(runnerTemp, "mutation-base", "reports", "mutation", "mutation.json");
  await repo.write({ "tests/fixtures/kept/names.json": names(["ab"]) });

  const scope = await scopeOf(repo, base, baseline);
  const head = await runStep("Build scope report at head", repo.dir, { ...scope, RUNNER_TEMP: runnerTemp });

  expect(head.exitCode).toBe(0);
  const unfiltered = (await readReport(repo)).files["src/kept.ts"]?.mutants.find((mutant) => mutant.replacement === "names");
  expect(unfiltered?.status).toBe("Survived");
}, 120_000);

test("stryker mutates a scoped file whose name holds glob characters, and not the file those characters would match", async () => {
  const { repo, base } = await strykerRepo(
    "tests/unit/routes.test.ts",
    {
      "src/routes/[id].ts": "export const route = (id: number) => id > 1;\n",
      "src/routes/i.ts": "export const index = (page: number) => page > 2;\n",
      "tests/unit/routes.test.ts": [
        'import { expect, test } from "bun:test";',
        'import { route } from "../../src/routes/[id].ts";',
        'import { index } from "../../src/routes/i.ts";',
        "",
        'test("routes compare", () => {',
        "  expect(route(2)).toBe(true);",
        "  expect(index(3)).toBe(true);",
        "});",
        "",
      ].join("\n"),
    },
    ["src/**/*.ts"],
  );
  await repo.write({ "src/routes/[id].ts": "export const route = (id: number) => id >= 2;\n" });

  const scope = await scopeOf(repo, base);
  const stryker = await ran($`bunx stryker run --mutate ${scope["SCOPE"] ?? ""}`.cwd(repo.dir));

  expect(stryker.exitCode).toBe(0);
  expect(Object.keys((await readReport(repo)).files)).toEqual(["src/routes/[id].ts"]);
}, 120_000);
