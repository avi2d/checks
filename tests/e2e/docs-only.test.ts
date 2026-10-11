import { expect, test } from "bun:test";
import { fixtureRepos, type FixtureRepo, type Ran } from "./lib/fixture-repo.ts";

const open = fixtureRepos("checks-docs-only-");

function docsOnly(repo: FixtureRepo, base: string, head: string): Promise<Ran> {
  return repo.script("delivery/docs-only.ts", base, head);
}

test(
  "a change to Markdown and docs paths reports docs-only",
  async () => {
    const repo = await open({ "README.md": "# widget\n", "src/index.ts": "export const answer = 42;\n" });
    const base = await repo.commit("feat: base");
    await repo.write({ "README.md": "# widget\n\nText.\n", "docs/guide.md": "# guide\n" });
    const head = await repo.commit("docs: guide");
    const run = await docsOnly(repo, base, head);
    expect(run.exitCode).toBe(0);
    expect(run.text).toContain("docs-only=true");
  },
  60_000,
);

test(
  "a change to a Markdown test fixture keeps the full run",
  async () => {
    const repo = await open({ "README.md": "# widget\n", "tests/fixtures/docs/readme.md": "## Install\n" });
    const base = await repo.commit("feat: base");
    await repo.write({ "tests/fixtures/docs/readme.md": "## Setup\n" });
    const head = await repo.commit("test: rename the fixture heading");
    const run = await docsOnly(repo, base, head);
    expect(run.exitCode).toBe(0);
    expect(run.text).toContain("docs-only=false");
  },
  60_000,
);

test(
  "a change outside Markdown and docs paths keeps the full run",
  async () => {
    const repo = await open({ "README.md": "# widget\n", "src/index.ts": "export const answer = 42;\n" });
    const base = await repo.commit("feat: base");
    await repo.write({ "src/index.ts": "export const answer = 43;\n" });
    const head = await repo.commit("feat: bump");
    const run = await docsOnly(repo, base, head);
    expect(run.exitCode).toBe(0);
    expect(run.text).toContain("docs-only=false");
  },
  60_000,
);

test(
  "an empty range keeps the full run and says it changes no file",
  async () => {
    const repo = await open({ "README.md": "# widget\n" });
    const head = await repo.commit("feat: base");
    const run = await docsOnly(repo, head, head);
    expect(run.exitCode).toBe(0);
    expect(run.text).toContain("docs-only=false");
    expect(run.text).toContain("docs-only: the range changes no file, so the full run stays");
    expect(run.text).not.toContain("need the full run");
  },
  60_000,
);

test(
  "a run with no range keeps the full run",
  async () => {
    const repo = await open({});
    const run = await repo.script("delivery/docs-only.ts");
    expect(run.exitCode).toBe(0);
    expect(run.text).toContain("docs-only=false");
  },
  60_000,
);
