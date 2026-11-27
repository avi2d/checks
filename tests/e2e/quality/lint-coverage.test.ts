import { $ } from "bun";
import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { consumerTrees, KIT_BIN, type KitTree } from "../lib/consumer-tree.ts";
import { CHECKOUT, ran, type Ran } from "../lib/fixture-repo.ts";

const SCRIPT = join(CHECKOUT, "src", "quality", "lint-coverage.sh");
const BIN = join(CHECKOUT, "node_modules", ".bin");
const SYSTEM_PATH = "/usr/bin:/bin";
const PLANT = "src/skipped.ts";

const consumerTree = consumerTrees("checks-lint-coverage-consumer-");

let dir = "";

const KIT_PATH = `${BIN}:${process.env.PATH ?? ""}`;

function coverage(path = KIT_PATH, cwd = dir): Promise<Ran> {
  return ran($`${SCRIPT}`.cwd(cwd).env({ ...process.env, PATH: path }));
}

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "checks-lint-coverage-"));
  await $`mkdir -p src`.cwd(dir).quiet();
  await writeFile(join(dir, "src", "linted.ts"), "export const a = 1;\n");
  await writeFile(join(dir, "src", "also-linted.ts"), "export const c = 3;\n");
  await writeFile(join(dir, PLANT), "export const b = 2;\n");
  await writeFile(join(dir, "package.json"), JSON.stringify({ name: "linted" }));
  await writeFile(join(dir, ".gitignore"), "");
  await $`git init -q && git add -A`.cwd(dir).quiet();
  await $`mkdir -p node_modules/.bin`.cwd(dir).quiet();
  for (const tool of ["oxlint", "tsc"]) {
    await symlink(await realpath(join(BIN, tool)), join(dir, "node_modules", ".bin", tool));
  }
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
  "lint-coverage skips with a note where no root package.json holds rather than failing the walk",
  async () => {
    const tree = await mkdtemp(join(tmpdir(), "checks-lint-coverage-no-manifest-"));
    try {
      await $`mkdir -p src`.cwd(tree).quiet();
      await writeFile(join(tree, "src", "linted.ts"), "export const a = 1;\n");
      await $`git init -q && git add -A`.cwd(tree).quiet();
      const skipped = await coverage(KIT_PATH, tree);
      expect(skipped.exitCode).toBe(0);
      expect(skipped.text).toContain("lint-coverage: no package.json at the repository root, so the gate skips");
    } finally {
      await rm(tree, { recursive: true, force: true });
    }
  },
  60_000,
);
test(
  "lint-coverage cannot decide when the repository's own install lacks oxlint, by the missing oxlint path both shells print rather than any failure text or one shell's wording",
  async () => {
    const bare = await mkdtemp(join(tmpdir(), "checks-lint-coverage-no-install-"));
    try {
      await $`mkdir -p src`.cwd(bare).quiet();
      await writeFile(join(bare, "src", "linted.ts"), "export const a = 1;\n");
      await writeFile(join(bare, "package.json"), JSON.stringify({ name: "linted" }));
      await $`git init -q && git add -A`.cwd(bare).quiet();
      const undecided = await coverage(SYSTEM_PATH, bare);
      expect(undecided.exitCode).toBe(2);
      expect(undecided.text).toContain("oxlint could not walk the tree");
      expect(undecided.text).toContain(`${await realpath(bare)}/node_modules/.bin/oxlint: `);
    } finally {
      await rm(bare, { recursive: true, force: true });
    }
  },
  60_000,
);

test(
  "lint-coverage finds oxlint and tsc in the repository's own install when PATH lacks node_modules/.bin",
  async () => {
    const tree = await mkdtemp(join(tmpdir(), "checks-lint-coverage-own-install-"));
    try {
      await $`mkdir -p src node_modules/.bin`.cwd(tree).quiet();
      await writeFile(join(tree, "src", "linted.ts"), "export const a = 1;\n");
      await writeFile(join(tree, ".gitignore"), "node_modules/\n");
      await writeFile(join(tree, "package.json"), JSON.stringify({ name: "linted", type: "module" }));
      await writeFile(
        join(tree, "tsconfig.json"),
        JSON.stringify({ extends: join(CHECKOUT, "tsconfig.effect.json"), files: ["src/linted.ts"] }),
      );
      for (const tool of ["oxlint", "tsc"]) {
        await symlink(await realpath(join(BIN, tool)), join(tree, "node_modules", ".bin", tool));
      }
      await $`git init -q && git add -A`.cwd(tree).quiet();
      const stripped = (process.env["PATH"] ?? "").split(":").filter((entry) => !entry.includes("node_modules")).join(":");
      const green = await ran($`${SCRIPT}`.cwd(tree).env({ ...process.env, PATH: stripped }));
      expect(green.text).toContain("lint-coverage: 1/1 tracked .ts/.tsx/.astro files");
      expect(green.text).toContain("holds the ts-reset rules is-array and json-parse");
      expect(green.exitCode).toBe(0);
    } finally {
      await rm(tree, { recursive: true, force: true });
    }
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
    expect(undecided.text).toContain("tsconfig.json(1,9): error TS1005: '}' expected.");
    expect(undecided.text).not.toContain("lib.es5.d.ts");

    expect((await coverage()).exitCode).toBe(0);
  },
  60_000,
);

test(
  "lint-coverage stays red on a skipped file when tsc then cannot read tsconfig.json",
  async () => {
    await writeFile(join(dir, ".gitignore"), `${PLANT}\n`);
    await writeFile(join(dir, "tsconfig.json"), "{ broken");
    const red = await coverage();
    await rm(join(dir, "tsconfig.json"));
    await writeFile(join(dir, ".gitignore"), "");
    expect(red.text).toContain("skips 1/3");
    expect(red.text).toContain("tsc could not list the program tsconfig.json builds");
    expect(red.exitCode).toBe(1);
  },
  60_000,
);

test(
  "lint-coverage goes red on a gitignored tracked .astro file, green once it is restored",
  async () => {
    await writeFile(join(dir, "src", "skipped.astro"), "---\nconst title = \"plant\";\n---\n<html><body><h1>{title}</h1></body></html>\n");
    await $`git add -A`.cwd(dir).quiet();
    await writeFile(join(dir, ".gitignore"), "src/skipped.astro\n");
    const red = await coverage();
    expect(red.exitCode).toBe(1);
    expect(red.text).toContain("skips 1/4");
    expect(red.text).toContain("src/skipped.astro");

    await writeFile(join(dir, ".gitignore"), "");
    const green = await coverage();
    expect(green.exitCode).toBe(0);
    expect(green.text).toContain("4/4 tracked .ts/.tsx/.astro files");

    await $`rm src/skipped.astro && git add -A`.cwd(dir).quiet();
  },
  60_000,
);

test(
  "lint-coverage passes over the ts-reset rules in a repository that tracks only .astro files beside a tsconfig.json",
  async () => {
    const astro = await mkdtemp(join(tmpdir(), "checks-lint-coverage-astro-"));
    try {
      await $`mkdir -p src/pages`.cwd(astro).quiet();
      await writeFile(join(astro, "src", "pages", "index.astro"), "---\nconst { title } = Astro.props;\n---\n<h1>{title}</h1>\n");
      await writeFile(join(astro, "tsconfig.json"), JSON.stringify({ compilerOptions: { strict: true } }));
      await writeFile(join(astro, "package.json"), JSON.stringify({ name: "linted-astro" }));
      await $`git init -q && git add -A && mkdir -p node_modules/.bin`.cwd(astro).quiet();
      for (const tool of ["oxlint", "tsc"]) {
        await symlink(await realpath(join(BIN, tool)), join(astro, "node_modules", ".bin", tool));
      }

      const green = await coverage(KIT_PATH, astro);
      expect(green.text).toContain("1/1 tracked .ts/.tsx/.astro files");
      expect(green.text).toContain("no tracked .ts/.tsx files, so no program to hold the ts-reset rules");
      expect(green.exitCode).toBe(0);
    } finally {
      await rm(astro, { recursive: true, force: true });
    }
  },
  60_000,
);

test(
  "lint-coverage goes red on a consumer tsconfig.json that sets both files and include, green on include alone and on neither",
  async () => {
    const tree = await consumerTree({ paths: ["src/**/*.ts"], include: ["src/**/*.ts"], types: [] });
    await tree.put("src/app.ts", "export const app = 1;\n");
    await tree.put("package.json", { name: "linted-consumer", type: "module" });
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

const QUEUES = "packages/queues/oxlint.config.ts";

const ANY_BOUNDARY = "export function seed(value: any) {\n  return value;\n}\n";

test(
  "lint-coverage goes red on a nested oxlint config that turns rules off for its package, rather than passing what oxlint no longer flags there",
  async () => {
    const tree = await consumerTree({ paths: ["src/**/*.ts", "packages/**/*.ts"], include: ["src/**/*.ts", "packages/**/*.ts"], types: [] });
    await tree.put("package.json", { name: "nested-consumer", type: "module" });
    await tree.put("src/control.ts", ANY_BOUNDARY);
    await tree.put("packages/queues/src/seed-nested.ts", ANY_BOUNDARY);
    await tree.put(
      QUEUES,
      'export default { rules: { "typescript/no-explicit-any": "off", "typescript/explicit-module-boundary-types": "off", "max-lines": "off" } };\n',
    );
    await $`git add -A`.cwd(tree.dir).quiet();

    const oxlint = join(KIT_BIN, "oxlint");
    expect((await tree.run(oxlint, ["src/control.ts"])).exitCode).toBe(1);
    expect((await tree.run(oxlint, ["packages/queues/src/seed-nested.ts"])).exitCode).toBe(0);

    const red = await tree.run(SCRIPT, []);
    expect(red.text).toContain(`lint-coverage: ${QUEUES} turns off or down rules the root oxlint config sets`);
    expect(red.text).toMatch(/ {2}off: .*\btypescript\/no-explicit-any\b/);
    expect(red.text).toMatch(/ {2}off: .*\btypescript\/explicit-module-boundary-types\b/);
    expect(red.text).toMatch(/ {2}off: .*\bmax-lines\b/);
    expect(red.exitCode).toBe(1);
  },
  60_000,
);

const VENDOR_APP = "packages/app/oxlint.config.ts";

const VENDORED_ANY = "export declare function vendored(value: any): any;\n";

test(
  "lint-coverage goes red on a nested override whose slashless files pattern oxlint applies at any depth, rather than matching it beside the config alone",
  async () => {
    const tree = await consumerTree({ paths: ["src/**/*.ts", "packages/**/*.ts"], include: ["src/**/*.ts", "packages/**/*.ts"], types: [] });
    await tree.put("package.json", { name: "nested-consumer", type: "module" });
    await tree.put("src/vendor/control.d.ts", VENDORED_ANY);
    await tree.put("packages/app/vendor/kit.d.ts", VENDORED_ANY);
    await tree.put(
      VENDOR_APP,
      [
        'import { defineConfig } from "@avi2dg/checks/oxlint";',
        "",
        "const { options: _rootOnly, ...config } = defineConfig({",
        '  effect: { files: ["**/*.ts"] },',
        '  overrides: [{ files: ["*.d.ts"], rules: { "typescript/no-explicit-any": "off" } }],',
        "});",
        "",
        "export default config;",
        "",
      ].join("\n"),
    );
    await $`git add -A`.cwd(tree.dir).quiet();

    const oxlint = join(KIT_BIN, "oxlint");
    expect((await tree.run(oxlint, ["src/vendor/control.d.ts"])).text).toContain("no-explicit-any");
    expect((await tree.run(oxlint, ["packages/app/vendor/kit.d.ts"])).text).not.toContain("no-explicit-any");

    const red = await tree.run(SCRIPT, []);
    expect(red.text).toContain(`lint-coverage: ${VENDOR_APP} turns off or down rules the root oxlint config sets`);
    expect(red.text).toContain("  off: typescript/no-explicit-any\n");
    expect(red.exitCode).toBe(1);
  },
  60_000,
);

const UNLOADED_CONFIGS = ["oxlint.config.js", "oxlint.config.mjs", "oxlint.config.cjs", "oxlint.config.cts"];

test(
  "lint-coverage stays green on a nested oxlint.config.js, .mjs, .cjs or .cts that oxlint never loads, rather than refusing the rule it names",
  async () => {
    const tree = await consumerTree({ paths: ["src/**/*.ts", "packages/**/*.ts"], include: ["src/**/*.ts", "packages/**/*.ts"], types: [] });
    await tree.put("package.json", { name: "nested-consumer", type: "module" });
    await tree.put("src/control.ts", ANY_BOUNDARY);
    for (const name of UNLOADED_CONFIGS) {
      const directory = `packages/${name.replaceAll(".", "-")}`;
      const exported = name.endsWith("js") && !name.endsWith("cjs") ? "export default" : "module.exports =";
      await tree.put(`${directory}/src/seed.ts`, ANY_BOUNDARY);
      await tree.put(`${directory}/${name}`, `${exported} { plugins: ["typescript"], rules: { "typescript/no-explicit-any": "off" } };\n`);
    }
    await $`git add -A`.cwd(tree.dir).quiet();

    const oxlint = join(KIT_BIN, "oxlint");
    expect((await tree.run(oxlint, ["src/control.ts"])).exitCode).toBe(1);
    for (const name of UNLOADED_CONFIGS) {
      expect((await tree.run(oxlint, [`packages/${name.replaceAll(".", "-")}/src/seed.ts`])).exitCode).toBe(1);
    }

    const green = await tree.run(SCRIPT, []);
    expect(green.text).toContain("lint-coverage: no nested oxlint config\n");
    expect(green.exitCode).toBe(0);
  },
  60_000,
);

const DEEPER = "packages/a/b/.oxlintrc.json";

test(
  "lint-coverage judges a file by the nested config in its own directory, rather than by a shallower one whose longer file name sorts first",
  async () => {
    const tree = await consumerTree({ paths: ["src/**/*.ts", "packages/**/*.ts"], include: ["src/**/*.ts", "packages/**/*.ts"], types: [] });
    await tree.put("package.json", { name: "nested-consumer", type: "module" });
    await tree.put("src/control.ts", ANY_BOUNDARY);
    await tree.put("packages/a/b/x.ts", ANY_BOUNDARY);
    await tree.put(
      "packages/a/oxlint.config.mts",
      [
        'import { defineConfig } from "@avi2dg/checks/oxlint";',
        "",
        'const { options: _rootOnly, ...config } = defineConfig({ effect: { files: ["**/*.ts"] } });',
        "",
        "export default config;",
        "",
      ].join("\n"),
    );
    await tree.put(DEEPER, { plugins: ["typescript"], rules: { "typescript/no-explicit-any": "off" } });
    await $`git add -A`.cwd(tree.dir).quiet();

    const oxlint = join(KIT_BIN, "oxlint");
    expect((await tree.run(oxlint, ["src/control.ts"])).exitCode).toBe(1);
    expect((await tree.run(oxlint, ["packages/a/b/x.ts"])).exitCode).toBe(0);

    const red = await tree.run(SCRIPT, []);
    expect(red.text).toContain(`lint-coverage: ${DEEPER} turns off or down rules the root oxlint config sets`);
    expect(red.text).toContain("  off: typescript/no-explicit-any\n");
    expect(red.exitCode).toBe(1);
  },
  60_000,
);

const HERDR = "packages/herdr-app/oxlint.config.ts";

const SIZE_AND_ANY = ["typescript/no-explicit-any", "max-lines", "max-lines-per-function", "max-statements", "readability/cognitive-complexity", "max-depth"];

const EFFECT_RULE_NAMES = ["node/no-sync", "oxc/no-async-await", "promise/avoid-new", "unicorn/no-process-exit", "effect-channel/no-throw", "effect-channel/no-try-catch"];

async function vendoredTypesTree(): Promise<KitTree> {
  const tree = await consumerTree({ paths: ["src/**/*.ts", "packages/**/*.ts"], include: ["src/**/*.ts", "packages/**/*.ts"], types: [] });
  await tree.put("package.json", { name: "nested-consumer", type: "module" });
  await tree.put("src/app.ts", "export const app = 1;\n");
  await tree.put("packages/herdr-app/src/main.ts", "export const main = 1;\n");
  await tree.put("packages/herdr-app/app-types/0.1.0/kit.d.ts", "export declare function vendored(value: any): any;\n");
  await tree.put(
    HERDR,
    [
      'import { defineConfig } from "@avi2dg/checks/oxlint";',
      "",
      "const { options: _rootOnly, ...config } = defineConfig({",
      "  effect: false,",
      `  overrides: [{ files: ["app-types/**/*.d.ts"], rules: ${JSON.stringify(Object.fromEntries(SIZE_AND_ANY.map((rule) => [rule, "off"])))} }],`,
      "});",
      "",
      "export default config;",
      "",
    ].join("\n"),
  );
  return tree;
}

function allowing(rules: readonly string[]): string {
  return `import { defineConfig } from "@avi2dg/checks/config";\n\nexport default defineConfig({ lintCoverage: { allowedNestedOxlintRules: ${JSON.stringify({ [HERDR]: rules })} } });\n`;
}

test(
  "lint-coverage passes a nested oxlint config whose turned-off rules checks.config.ts lists, and goes red on the one rule the list leaves out rather than on every rule",
  async () => {
    const tree = await vendoredTypesTree();
    await tree.put("checks.config.ts", allowing([...SIZE_AND_ANY, ...EFFECT_RULE_NAMES]));
    await $`git add -A`.cwd(tree.dir).quiet();

    const green = await tree.run(SCRIPT, []);
    expect(green.text).not.toContain("turns off or down");
    expect(green.exitCode).toBe(0);

    await tree.put("checks.config.ts", allowing([...SIZE_AND_ANY.filter((rule) => rule !== "typescript/no-explicit-any"), ...EFFECT_RULE_NAMES]));
    const red = await tree.run(SCRIPT, []);
    expect(red.text).toContain(`lint-coverage: ${HERDR} turns off or down rules the root oxlint config sets`);
    expect(red.text).toContain("  off: typescript/no-explicit-any\n");
    expect(red.text).not.toContain("  off: max-lines\n");
    expect(red.text).not.toContain("  off: node/no-sync\n");
    expect(red.exitCode).toBe(1);
  },
  60_000,
);

test(
  "lint-coverage matches an eslint-plugin-unicorn/ entry to the unicorn/ rule oxlint prints, rather than calling the rule unlisted and the entry stale",
  async () => {
    const tree = await vendoredTypesTree();
    const prefixed = EFFECT_RULE_NAMES.map((rule) => (rule === "unicorn/no-process-exit" ? "eslint-plugin-unicorn/no-process-exit" : rule));
    await tree.put("checks.config.ts", allowing([...SIZE_AND_ANY, ...prefixed]));
    await $`git add -A`.cwd(tree.dir).quiet();

    const green = await tree.run(SCRIPT, []);
    expect(green.text).not.toContain("turns off or down rules the root oxlint config sets");
    expect(green.text).not.toContain("which it does not turn off or down");
    expect(green.exitCode).toBe(0);
  },
  60_000,
);

test(
  "lint-coverage goes red on a checks.config.ts entry the nested configs no longer need, rather than letting the list outgrow what each config turns off",
  async () => {
    const tree = await vendoredTypesTree();
    await tree.put(
      "checks.config.ts",
      `import { defineConfig } from "@avi2dg/checks/config";\n\nexport default defineConfig({ lintCoverage: { allowedNestedOxlintRules: ${JSON.stringify({
        [HERDR]: [...SIZE_AND_ANY, ...EFFECT_RULE_NAMES, "no-debugger"],
        "packages/gone/oxlint.config.ts": ["max-lines"],
      })} } });\n`,
    );
    await $`git add -A`.cwd(tree.dir).quiet();

    const red = await tree.run(SCRIPT, []);
    expect(red.text).toContain(`lint-coverage: checks.config.ts lintCoverage.allowedNestedOxlintRules lets ${HERDR} turn off no-debugger, which it does not turn off or down`);
    expect(red.text).toContain("lint-coverage: checks.config.ts lintCoverage.allowedNestedOxlintRules names packages/gone/oxlint.config.ts, which is not a tracked nested oxlint config");
    expect(red.text).not.toContain("turns off or down rules the root oxlint config sets");
    expect(red.exitCode).toBe(1);
  },
  60_000,
);
