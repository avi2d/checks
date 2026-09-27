import { $ } from "bun";
import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { consumerTrees } from "./lib/consumer-tree.ts";
import { CHECKOUT, ran, type Ran } from "./lib/fixture-repo.ts";

const SCRIPT = join(CHECKOUT, "src", "quality", "lint-coverage.sh");
const BIN = join(CHECKOUT, "node_modules", ".bin");
const SYSTEM_PATH = "/usr/bin:/bin";
const PLANT = "src/skipped.ts";

const consumerTree = consumerTrees("checks-lint-coverage-consumer-");

let dir = "";

function coverage(path = `${BIN}:${process.env.PATH ?? ""}`): Promise<Ran> {
  return ran($`${SCRIPT}`.cwd(dir).env({ ...process.env, PATH: path }));
}

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "checks-lint-coverage-"));
  await $`mkdir -p src`.cwd(dir).quiet();
  await writeFile(join(dir, "src", "linted.ts"), "export const a = 1;\n");
  await writeFile(join(dir, "src", "also-linted.ts"), "export const c = 3;\n");
  await writeFile(join(dir, PLANT), "export const b = 2;\n");
  await writeFile(join(dir, ".gitignore"), "");
  await $`git init -q && git add -A`.cwd(dir).quiet();
});

afterAll(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
});

test(
  "lint-coverage goes red on a gitignored tracked file, green once it is restored",
  async () => {
    await writeFile(join(dir, ".gitignore"), `${PLANT}\n`);
    const red = await coverage();
    expect(red.exitCode).toBe(1);
    expect(red.text).toContain("skips 1/3");
    expect(red.text).toContain(PLANT);

    await writeFile(join(dir, ".gitignore"), "");
    const green = await coverage();
    expect(green.exitCode).toBe(0);
    expect(green.text).toContain("3/3");
    expect(green.text).toContain("no tsconfig.json, so no program to hold the ts-reset rules");
  },
  60_000,
);

test(
  "lint-coverage cannot decide without oxlint on PATH",
  async () => {
    const undecided = await coverage(SYSTEM_PATH);
    expect(undecided.exitCode).toBe(2);
    expect(undecided.text).toContain("oxlint could not walk the tree");
    expect(undecided.text).toContain("not found");
  },
  60_000,
);

test(
  "lint-coverage cannot decide when oxlint cannot read its config, and decides once it can",
  async () => {
    await writeFile(join(dir, ".oxlintrc.json"), "{ broken");
    const undecided = await coverage();
    await rm(join(dir, ".oxlintrc.json"));
    expect(undecided.exitCode).toBe(2);
    expect(undecided.text).toContain("Failed to parse oxlint config");

    expect((await coverage()).exitCode).toBe(0);
  },
  60_000,
);

test(
  "lint-coverage cannot decide when tsc cannot read tsconfig.json, and decides once it can",
  async () => {
    await writeFile(join(dir, "tsconfig.json"), "{ broken");
    const undecided = await coverage();
    await rm(join(dir, "tsconfig.json"));
    expect(undecided.exitCode).toBe(2);
    expect(undecided.text).toContain("tsc could not list the program tsconfig.json builds");

    expect((await coverage()).exitCode).toBe(0);
  },
  60_000,
);

test(
  "lint-coverage goes red on a consumer tsconfig.json that sets both files and include, green on include alone and on neither",
  async () => {
    const tree = await consumerTree({ paths: ["src/**/*.ts"], include: ["src/**/*.ts"], types: [] });
    await tree.put("src/app.ts", "export const app = 1;\n");
    await $`git add -A`.cwd(tree.dir).quiet();
    const tsconfig = (own: Readonly<Record<string, unknown>>) =>
      tree.put("tsconfig.json", { extends: "@avi2dg/checks/tsconfig.effect.json", compilerOptions: { strict: true, noEmit: true }, ...own });

    await tsconfig({ files: ["src/app.ts"], include: ["src/**/*.ts"] });
    const red = await tree.run(SCRIPT, []);
    expect(red.text).toContain("drops the ts-reset rules: is-array json-parse");
    expect(red.text).toContain("set files or include in tsconfig.json but not both");
    expect(red.exitCode).toBe(1);

    for (const own of [{ include: ["src/**/*.ts"] }, {}]) {
      await tsconfig(own);
      const green = await tree.run(SCRIPT, []);
      expect(green.text).toContain("holds the ts-reset rules is-array and json-parse");
      expect(green.exitCode).toBe(0);
    }
  },
  60_000,
);
