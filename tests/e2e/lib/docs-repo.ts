import { $ } from "bun";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const SCRIPT = resolve(import.meta.dir, "..", "..", "..", "scripts", "docs.ts");

export type DocsRepo = {
  readonly dir: string;
  readonly put: (path: string, text: string) => Promise<void>;
  readonly remove: (path: string) => Promise<void>;
  readonly commit: (message: string) => Promise<string>;
  readonly docs: (...args: readonly string[]) => Promise<{ readonly exitCode: number; readonly text: string }>;
  readonly dispose: () => Promise<void>;
};

export async function docsRepo(quality: unknown): Promise<DocsRepo> {
  const dir = await mkdtemp(join(tmpdir(), "checks-docs-"));
  await $`git init -q -b main`.cwd(dir).quiet();
  await $`git config user.name tester && git config user.email tester@example.com`.cwd(dir).quiet();
  const put = async (path: string, text: string): Promise<void> => {
    await mkdir(dirname(join(dir, path)), { recursive: true });
    await writeFile(join(dir, path), text);
  };
  await put("quality.json", JSON.stringify(quality));
  await put("widget.ts", "export const widget = 1;\n");
  return {
    dir,
    put,
    remove: (path) => rm(join(dir, path)),
    commit: async (message) => {
      await $`git add -A && git commit -q --no-gpg-sign -m ${message}`.cwd(dir).quiet();
      return (await $`git rev-parse HEAD`.cwd(dir).quiet()).stdout.toString().trim();
    },
    docs: async (...args) => {
      const result = await $`bun ${SCRIPT} ${args}`.cwd(dir).nothrow().quiet();
      return { exitCode: result.exitCode, text: result.stdout.toString() + result.stderr.toString() };
    },
    dispose: () => rm(dir, { recursive: true, force: true }),
  };
}
