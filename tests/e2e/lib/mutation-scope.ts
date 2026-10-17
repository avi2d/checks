import { $ } from "bun";
import { expect } from "bun:test";
import { join } from "node:path";
import { parseWorkflow, stepNamed } from "../../lib/workflow.ts";
import { CHECKOUT, fixtureRepos, ran, type FixtureRepo, type Ran } from "./fixture-repo.ts";

const SCOPE = join(CHECKOUT, "src", "testing", "mutation-scope.ts");
const WORKFLOW = join(CHECKOUT, ".github/workflows/mutation.yml");

export const body = (name: string): string => Array.from({ length: 20 }, (_, line) => `export const ${name}${line} = ${line};\n`).join("");

// Called at a test file's top level, as fixtureRepos is.
export function committedRepos(prefix: string): (files: Readonly<Record<string, string>>) => Promise<{ repo: FixtureRepo; base: string }> {
  const open = fixtureRepos(prefix);
  return async (files) => {
    const repo = await open({});
    await repo.write(files);
    const base = await repo.commit("base");
    return { repo, base };
  };
}

export async function scopeRun(repo: FixtureRepo, base: string, baseline?: string): Promise<Ran> {
  await repo.commit("head");
  return ran($`bun ${SCOPE} ${[base, ...(baseline === undefined ? [] : [baseline])]}`.cwd(repo.dir));
}

export async function scopeOf(repo: FixtureRepo, base: string, baseline?: string): Promise<Record<string, string>> {
  const done = await scopeRun(repo, base, baseline);
  expect(done.exitCode).toBe(0);
  return Object.fromEntries(
    done.text
      .trim()
      .split("\n")
      .filter((line) => /^[A-Z_]+=/.test(line))
      .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]),
  );
}

export async function runStep(name: string, cwd: string, env: Readonly<Record<string, string>>): Promise<Ran> {
  const step = stepNamed(parseWorkflow(await Bun.file(WORKFLOW).text()), name);
  return ran($`bash -e -c ${step.run}`.cwd(cwd).env({ ...process.env, ...step.env, ...env }));
}
