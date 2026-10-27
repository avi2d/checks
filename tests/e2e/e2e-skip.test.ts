import { expect, test } from "bun:test";
import { join } from "node:path";
import { $ } from "bun";
import { CHECKOUT, fixtureRepos, ran, type FixtureRepo, type Ran } from "./lib/fixture-repo.ts";

const open = fixtureRepos("checks-e2e-skip-");

function e2eSkip(repo: FixtureRepo, ...args: readonly string[]): Promise<Ran> {
  return ran($`bun ${join(CHECKOUT, "scripts", "e2e-skip.ts")} ${args}`.cwd(repo.dir));
}

test(
  "a change to Markdown and the root copy.json skips the e2e tier",
  async () => {
    const repo = await open({ "README.md": "# widget\n", "src/index.ts": "export const answer = 42;\n", "copy.json": "{}\n" });
    const base = await repo.commit("feat: base");
    await repo.write({ "README.md": "# widget\n\nText.\n", "docs/guide.md": "# guide\n", "copy.json": "{\"a\":1}\n" });
    const head = await repo.commit("docs: guide");
    const run = await e2eSkip(repo, base, head);
    expect(run.exitCode).toBe(0);
    expect(run.text).toContain("e2e-skip=true");
  },
  60_000,
);

test(
  "a source file renamed to Markdown still runs the e2e tier",
  async () => {
    const repo = await open({ "src/index.ts": "export const answer = 42;\n" });
    const base = await repo.commit("feat: base");
    await $`git mv src/index.ts index.md`.cwd(repo.dir).quiet();
    const head = await repo.commit("docs: move the source to Markdown");
    const run = await e2eSkip(repo, base, head);
    expect(run.exitCode).toBe(0);
    expect(run.text).toContain("e2e-skip=false");
  },
  60_000,
);

test(
  "a change to a source file runs the e2e tier",
  async () => {
    const repo = await open({ "README.md": "# widget\n", "src/index.ts": "export const answer = 42;\n" });
    const base = await repo.commit("feat: base");
    await repo.write({ "src/index.ts": "export const answer = 43;\n" });
    const head = await repo.commit("feat: bump");
    const run = await e2eSkip(repo, base, head);
    expect(run.exitCode).toBe(0);
    expect(run.text).toContain("e2e-skip=false");
  },
  60_000,
);

test(
  "an empty range runs the e2e tier and says it changes no file",
  async () => {
    const repo = await open({ "README.md": "# widget\n" });
    const head = await repo.commit("feat: base");
    const run = await e2eSkip(repo, head, head);
    expect(run.exitCode).toBe(0);
    expect(run.text).toContain("e2e-skip=false");
    expect(run.text).toContain("the range changes no file, so the e2e tier runs");
  },
  60_000,
);

test(
  "a run with no range runs the e2e tier",
  async () => {
    const repo = await open({});
    const run = await e2eSkip(repo);
    expect(run.exitCode).toBe(0);
    expect(run.text).toContain("e2e-skip=false");
  },
  60_000,
);
