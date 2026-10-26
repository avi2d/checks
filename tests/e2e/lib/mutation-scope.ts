import { $ } from "bun";
import { expect } from "bun:test";
import { join } from "node:path";
import { CHECKOUT, fixtureRepos, ran, type FixtureRepo, type Ran } from "./fixture-repo.ts";

const SCOPE = join(CHECKOUT, "src", "testing", "mutation-scope.ts");

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

// A Stryker report records each test file's source as the run read it, here the base commit's.
export async function recorded(repo: FixtureRepo, testFiles: Iterable<readonly [string, string | undefined]>): Promise<Record<string, unknown>> {
  const entries = await Promise.all(
    [...testFiles].map(async ([testFile, id]) => {
      const shown = await $`git show HEAD:${testFile}`.cwd(repo.dir).quiet().nothrow();
      const source = shown.exitCode === 0 ? { source: shown.stdout.toString() } : {};
      return [testFile, { ...source, tests: [{ id, name: testFile }] }] as const;
    }),
  );
  return Object.fromEntries(entries);
}

export type Link = { readonly testFile: string; readonly sources: string[]; readonly killsOnly?: boolean };

export async function coverageBaseline(repo: FixtureRepo, links: readonly Link[], uncovered: readonly string[] = []): Promise<string> {
  const ids = new Map(links.map(({ testFile }, index) => [testFile, `${index}`] as const));
  const testFiles = await recorded(repo, ids);
  const bySource = new Map<string, Array<{ coveredBy: string[]; killedBy: string[] }>>();
  for (const { testFile, sources, killsOnly } of links) {
    const id = ids.get(testFile) ?? "";
    for (const source of sources) {
      const mutants = bySource.get(source) ?? [];
      mutants.push(killsOnly === true ? { coveredBy: [], killedBy: [id] } : { coveredBy: [id], killedBy: [id] });
      bySource.set(source, mutants);
    }
  }
  for (const source of uncovered) bySource.set(source, [{ coveredBy: [], killedBy: [] }]);
  const files = Object.fromEntries([...bySource].map(([source, mutants]) => [source, { source: body("value"), mutants }]));
  const path = join(repo.dir, "baseline.json");
  await repo.write({ "baseline.json": JSON.stringify({ files, testFiles }) });
  return path;
}
