import { expect } from "bun:test";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { fixtureRepo, releasedAfterEach, type Ran } from "./fixture-repo.ts";

export const GUIDE = "tools/README.md";
export const OPENING = "# Tools\n\nThe tools build bills.\n";

export type Plant = {
  readonly red: string;
  readonly refusal: string;
  readonly green: string;
};

export type DocsRepo = {
  readonly dir: string;
  readonly put: (path: string, text: string) => Promise<void>;
  readonly remove: (path: string) => Promise<void>;
  readonly commit: (message: string) => Promise<string>;
  readonly docs: (...args: readonly string[]) => Promise<Ran>;
  readonly dispose: () => Promise<void>;
};

export async function docsRepo(quality: unknown): Promise<DocsRepo> {
  const { dir, write, commit, script, dispose } = await fixtureRepo("checks-docs-", {
    "quality.json": JSON.stringify(quality),
    "widget.ts": "export const widget = 1;\n",
  });
  return {
    dir,
    put: (path, text) => write({ [path]: text }),
    remove: (path) => rm(join(dir, path)),
    commit,
    docs: (...args) => script("docs.ts", ...args),
    dispose,
  };
}

export function docsRepos(): (quality: unknown) => Promise<DocsRepo> {
  return releasedAfterEach(docsRepo, (repo) => repo.dispose());
}

export async function plantRedThenGreen<P extends Plant>(
  { put, commit, docs }: DocsRepo,
  plants: readonly P[],
  messages: (plant: P) => readonly [planted: string, fixed: string],
  held: string,
): Promise<void> {
  await put(GUIDE, OPENING);
  let previous = await commit("start");
  for (const plant of plants) {
    const [plantMessage, fixMessage] = messages(plant);
    await put(GUIDE, `${OPENING}${plant.red}\n`);
    const planted = await commit(plantMessage);
    const refused = await docs(previous, planted);
    expect(refused.text).toContain(`  ${GUIDE}:${plant.refusal}`);
    expect(refused.exitCode).toBe(1);

    await put(GUIDE, `${OPENING}${plant.green}\n`);
    const fixed = await commit(fixMessage);
    const kept = await docs(planted, fixed);
    expect(kept.text).toContain(held);
    expect(kept.exitCode).toBe(0);
    previous = fixed;
  }
}
