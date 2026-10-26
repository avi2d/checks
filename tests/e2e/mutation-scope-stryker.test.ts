import { $ } from "bun";
import { expect, test } from "bun:test";
import { symlink } from "node:fs/promises";
import { join } from "node:path";
import { CHECKOUT, ran, type FixtureRepo } from "./lib/fixture-repo.ts";
import { committedRepos, scopeOf } from "./lib/mutation-scope.ts";

const repoWith = committedRepos("checks-mutation-scope-stryker-");

type HeadReport = { readonly files: Readonly<Record<string, unknown>> };

const readReport = (repo: FixtureRepo): Promise<HeadReport> => Bun.file(join(repo.dir, "reports", "mutation", "mutation.json")).json();

async function strykerRepo(testFile: string, files: Readonly<Record<string, string>>, mutate: readonly string[]): Promise<{ repo: FixtureRepo; base: string }> {
  const { repo, base } = await repoWith({
    ".gitignore": "node_modules\nreports\n.stryker-tmp\n",
    "package.json": '{"name":"stryker-fixture","type":"module","private":true}\n',
    "stryker.conf.mjs": `export default ${JSON.stringify({
      plugins: ["@stryker-mutator/*", "@hughescr/stryker-bun-runner"],
      testRunner: "bun",
      coverageAnalysis: "perTest",
      reporters: ["json"],
      mutate,
      bun: { testFiles: [testFile] },
      concurrency: 1,
    })};\n`,
    ...files,
  });
  await symlink(join(CHECKOUT, "node_modules"), join(repo.dir, "node_modules"));
  return { repo, base };
}

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
