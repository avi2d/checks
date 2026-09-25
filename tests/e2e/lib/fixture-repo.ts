import { $ } from "bun";
import { afterEach } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { withoutPullRequestEvent } from "../../lib/env.ts";

export const CHECKOUT = resolve(import.meta.dir, "..", "..", "..");

const AUTHOR = { name: "Wren Fixture", email: "wren@example.com" };
const IDENTITY = ["-c", `user.name=${AUTHOR.name}`, "-c", `user.email=${AUTHOR.email}`];
const KIT_PATH = `${join(CHECKOUT, "node_modules", ".bin")}:${process.env["PATH"] ?? ""}`;

export type Ran = { readonly exitCode: number; readonly text: string };

export type FixtureRepo = {
  readonly dir: string;
  readonly write: (files: Readonly<Record<string, string>>) => Promise<void>;
  readonly commit: (message: string) => Promise<string>;
  readonly script: (name: string, ...args: readonly string[]) => Promise<Ran>;
  readonly lint: () => Promise<Ran>;
  readonly dispose: () => Promise<void>;
};

export async function ran(pending: $.ShellPromise): Promise<Ran> {
  const result = await pending.nothrow().quiet();
  return { exitCode: result.exitCode, text: result.stdout.toString() + result.stderr.toString() };
}

export async function fixtureRepo(prefix: string, files: Readonly<Record<string, string>>): Promise<FixtureRepo> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  await $`git init -q -b main`.cwd(dir).quiet();
  const write = async (written: Readonly<Record<string, string>>): Promise<void> => {
    for (const [name, content] of Object.entries(written)) {
      await mkdir(dirname(join(dir, name)), { recursive: true });
      await writeFile(join(dir, name), content);
    }
  };
  await write(files);
  return {
    dir,
    write,
    commit: async (message) => {
      await $`git add -A && git ${IDENTITY} commit -q --no-gpg-sign -m ${message}`.cwd(dir).quiet();
      return (await $`git rev-parse HEAD`.cwd(dir).quiet()).stdout.toString().trim();
    },
    script: (name, ...args) => ran($`bun ${join(CHECKOUT, "scripts", name)} ${args}`.cwd(dir).env({ ...process.env, PATH: KIT_PATH })),
    lint: () => ran($`bun ${join(CHECKOUT, "scripts", "lint.ts")}`.cwd(dir).env({ ...withoutPullRequestEvent(), PATH: KIT_PATH })),
    dispose: () => rm(dir, { recursive: true, force: true }),
  };
}

// Called at a test file's top level, so afterEach disposes of each repository for every test in the file.
export function fixtureRepos(prefix: string): (files?: Readonly<Record<string, string>>) => Promise<FixtureRepo> {
  const opened: FixtureRepo[] = [];
  afterEach(async () => {
    for (const repo of opened.splice(0)) await repo.dispose();
  });
  return async (files = {}) => {
    const repo = await fixtureRepo(prefix, files);
    opened.push(repo);
    return repo;
  };
}

export async function lintWiring(quality: Readonly<Record<string, unknown>>): Promise<Readonly<Record<string, string>>> {
  return {
    "package.json": JSON.stringify({ name: "lint-fixture", type: "module", scripts: { lint: "checks-lint", test: "checks-test" } }),
    "bunfig.toml": await Bun.file(join(CHECKOUT, "bunfig.toml")).text(),
    ".github/workflows/ci.yml": "on: pull_request\njobs:\n  lint:\n    runs-on: ubuntu-latest\n    steps:\n      - run: bun run lint\n",
    "quality.json": JSON.stringify({ gates: { ci: ["bun run lint"] }, commitIdentity: { authors: [AUTHOR] }, ...quality }),
  };
}
