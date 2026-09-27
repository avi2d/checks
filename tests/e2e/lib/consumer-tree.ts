import { $ } from "bun";
import { mkdir, readFile, readdir, symlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Schema } from "effect";
import { withoutPullRequestEvent } from "../../lib/env.ts";
import { CHECKOUT, ran, scratchDirs, type Ran } from "./fixture-repo.ts";

export const KIT_BIN = join(CHECKOUT, "node_modules", ".bin");

export type KitTree = {
  readonly dir: string;
  readonly put: (file: string, content: string | Readonly<Record<string, unknown>>) => Promise<void>;
  readonly run: (program: string, args: readonly string[]) => Promise<Ran>;
};

export type ConsumerShape = {
  readonly paths: readonly string[];
  readonly include: readonly string[];
  readonly types: readonly string[];
};

export function kitTree(dir: string): KitTree {
  return {
    dir,
    put: async (file, content) => {
      await mkdir(dirname(join(dir, file)), { recursive: true });
      await writeFile(join(dir, file), typeof content === "string" ? content : JSON.stringify(content, null, 2));
    },
    run: (program, args) =>
      ran($`${program} ${args}`.cwd(dir).env({ ...withoutPullRequestEvent(), PATH: `${KIT_BIN}:${process.env["PATH"] ?? ""}` })),
  };
}

export function consumerTrees(prefix: string): (shape: ConsumerShape) => Promise<KitTree> {
  const scratch = scratchDirs();
  return async ({ paths, include, types }) => {
    const tree = kitTree(await scratch(prefix));
    await mkdir(join(tree.dir, "node_modules", "@avi2dg"), { recursive: true });
    for (const entry of await readdir(join(CHECKOUT, "node_modules"))) {
      await symlink(join(CHECKOUT, "node_modules", entry), join(tree.dir, "node_modules", entry));
    }
    await symlink(CHECKOUT, join(tree.dir, "node_modules", "@avi2dg", "checks"));
    const oxlint = Schema.decodeSync(Schema.fromJsonString(Schema.Struct({
      plugins: Schema.Array(Schema.String),
      rules: Schema.Record(Schema.String, Schema.String),
    })))(await readFile(join(CHECKOUT, "src/quality/presets/effect.oxlint.json"), "utf8"));
    const service = Schema.decodeSync(Schema.fromJsonString(Schema.Struct({
      diagnosticSeverity: Schema.Record(Schema.String, Schema.String),
    })))(await readFile(join(CHECKOUT, "src/quality/presets/effect.language-service.json"), "utf8"));
    await tree.put(".gitignore", "node_modules/\n");
    await tree.put(".oxlintrc.json", {
      extends: ["./node_modules/@avi2dg/checks/oxlintrc.json"],
      plugins: ["typescript", "oxc", "eslint", "import"],
      overrides: [{ files: paths, plugins: ["typescript", "oxc", "eslint", "import", ...oxlint.plugins], rules: oxlint.rules }],
    });
    await tree.put("tsconfig.json", {
      extends: ["@avi2dg/checks/tsconfig.effect.json"],
      compilerOptions: {
        target: "esnext", module: "preserve", moduleResolution: "bundler", strict: true, noEmit: true, types,
        plugins: [{ name: "@effect/language-service", overrides: [{ include: paths, options: service }] }],
      },
      include,
    });
    await $`git init -q -b main`.cwd(tree.dir).quiet();
    return tree;
  };
}
