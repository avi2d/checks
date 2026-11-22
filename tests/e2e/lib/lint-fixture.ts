import { $ } from "bun";
import { join } from "node:path";
import { withoutPullRequestEvent } from "../../lib/env.ts";
import { CHECKOUT, fixtureRepos, lintWiring, ran, withOwnInstall, type FixtureRepo, type Ran } from "./fixture-repo.ts";

const SCRIPT = join(CHECKOUT, "src", "core", "lint.ts");
const OWNER = ["-c", "user.name=Wren Fixture", "-c", "user.email=wren@example.com"];
export const STRANGER = ["-c", "user.name=stranger", "-c", "user.email=stranger@example.com"];
export const open = fixtureRepos("checks-lint-");

export async function commit(repo: FixtureRepo, message: string, identity: readonly string[] = OWNER): Promise<string> {
  await $`git add -A && git ${identity} commit -q --no-gpg-sign -m ${message}`.cwd(repo.dir).quiet();
  return (await $`git rev-parse HEAD`.cwd(repo.dir).quiet()).stdout.toString().trim();
}

export async function repository(): Promise<{ repo: FixtureRepo; base: string }> {
  const repo = await open({ ...lintWiring(), "widget.ts": "export const widget = 42;\n" });
  await withOwnInstall(repo);
  const base = await commit(repo, "feat: base", ["-c", "user.name=Wren Fixture", "-c", "user.email=wren@example.com"]);
  await $`git update-ref refs/remotes/origin/main HEAD && git symbolic-ref refs/remotes/origin/HEAD refs/remotes/origin/main && git checkout -q -b feature`.cwd(repo.dir).quiet();
  return { repo, base };
}

export function lint(repo: FixtureRepo, args: readonly string[] = [], env: Readonly<Record<string, string>> = {}): Promise<Ran> {
  return ran($`bun ${SCRIPT} ${args}`.cwd(repo.dir).env({ ...withoutPullRequestEvent(), PATH: `${join(CHECKOUT, "node_modules/.bin")}:${process.env["PATH"] ?? ""}`, ...env }));
}

