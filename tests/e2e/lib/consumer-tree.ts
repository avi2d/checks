import { $ } from "bun";
import { mkdir, readdir, symlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { OXLINT_FRAGMENT, TSCONFIG_FRAGMENT } from "../../../scripts/quality.ts";
import { withoutPullRequestEvent } from "../../lib/env.ts";
import { CHECKOUT, ran, scratchDirs, type Ran } from "./fixture-repo.ts";

export const KIT_BIN = join(CHECKOUT, "node_modules", ".bin");

export type KitTree = {
  readonly dir: string;
  readonly put: (file: string, content: string | Readonly<Record<string, unknown>>) => Promise<void>;
  readonly run: (program: string, args: readonly string[]) => Promise<Ran>;
};

export type ConsumerShape = {
  readonly quality: Readonly<Record<string, unknown>>;
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

// Called at a test file's top level, so each tree opened is removed after its test.
export function consumerTrees(prefix: string): (shape: ConsumerShape) => Promise<KitTree> {
  const scratch = scratchDirs();
  return async ({ quality, include, types }) => {
    const tree = kitTree(await scratch(prefix));
    await mkdir(join(tree.dir, "node_modules", "@avi2dg"), { recursive: true });
    for (const entry of await readdir(join(CHECKOUT, "node_modules"))) {
      await symlink(join(CHECKOUT, "node_modules", entry), join(tree.dir, "node_modules", entry));
    }
    await symlink(CHECKOUT, join(tree.dir, "node_modules", "@avi2dg", "checks"));
    await tree.put(".gitignore", "node_modules/\n");
    await tree.put("quality.json", { $schema: "./node_modules/@avi2dg/checks/quality.schema.json", ...quality });
    await tree.put(".oxlintrc.json", {
      extends: ["./node_modules/@avi2dg/checks/oxlintrc.json", `./${OXLINT_FRAGMENT}`],
      plugins: ["typescript", "oxc", "eslint", "import"],
    });
    await tree.put("tsconfig.json", {
      extends: ["@avi2dg/checks/tsconfig.effect.json", `./${TSCONFIG_FRAGMENT}`],
      compilerOptions: { target: "esnext", module: "preserve", moduleResolution: "bundler", strict: true, noEmit: true, types },
      include,
    });
    await $`git init -q -b main`.cwd(tree.dir).quiet();
    return tree;
  };
}
