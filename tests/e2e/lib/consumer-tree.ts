import { $ } from "bun";
import { mkdir, readdir, symlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
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
    await tree.put(".gitignore", "node_modules/\n");
    await tree.put(
      "oxlint.config.ts",
      `import { defineConfig } from "@avi2dg/checks/oxlint";\n\nexport default defineConfig({ effect: { files: ${JSON.stringify(paths)} } });\n`,
    );
    await tree.put("tsconfig.json", {
      extends: ["@avi2dg/checks/tsconfig.effect.json"],
      compilerOptions: { target: "esnext", module: "preserve", moduleResolution: "bundler", strict: true, noEmit: true, types },
      include,
    });
    await $`git init -q -b main`.cwd(tree.dir).quiet();
    await $`bun ${join(CHECKOUT, "src", "quality", "effect-scope.ts")}`.cwd(tree.dir).quiet();
    return tree;
  };
}
