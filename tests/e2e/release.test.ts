import { $ } from "bun";
import { expect, test } from "bun:test";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { CHECKOUT, fixtureRepos, ran } from "./lib/fixture-repo.ts";

const REPORT = join(CHECKOUT, "scripts", "release-report.ts");
const NOTES = join(CHECKOUT, "scripts", "release-notes.ts");
const DATED = { GIT_AUTHOR_DATE: "2026-09-01T12:00:00+00:00", GIT_COMMITTER_DATE: "2026-09-01T12:00:00+00:00" };

const repository = fixtureRepos("checks-release-");

let dir = "";

async function initRepo(): Promise<void> {
  ({ dir } = await repository());
  await $`git config user.name tester && git config user.email tester@example.com`.cwd(dir).quiet();
}

async function commit(message: string): Promise<void> {
  await $`git add -A && git commit -q --no-gpg-sign --allow-empty -m ${message}`.cwd(dir).env({ ...process.env, ...DATED }).quiet();
}

function report(...args: readonly string[]) {
  return ran($`bun ${REPORT} ${args}`.cwd(dir).quiet());
}

function notes(...args: readonly string[]) {
  return ran($`bun ${NOTES} ${args}`.cwd(dir).quiet());
}

test(
  "after a tag, a feat or fix reports unreleased and a chore-only history reports clean",
  async () => {
    await initRepo();
    await commit("feat: build a bill (#1)");
    await $`git tag v0.1.0`.cwd(dir).quiet();
    await commit("docs: say why");
    expect(await report()).toEqual({ exitCode: 0, text: "release-report: no unreleased changes since v0.1.0\n" });

    await commit("fix(parts): keep the order of parts (#3)");
    expect(await report()).toEqual({
      exitCode: 1,
      text: "release-report: 1 unreleased change(s) since v0.1.0:\n  fix(parts): keep the order of parts (#3)\n",
    });
  },
  { timeout: 30_000 },
);

test(
  "a tag that reads as no version is passed over for the last release tag behind it",
  async () => {
    await initRepo();
    await commit("feat: build a bill (#1)");
    await $`git tag v0.1.0`.cwd(dir).quiet();
    await commit("fix(parts): keep the order of parts (#3)");
    await $`git tag no-mistakes-abandoned/fm/parts`.cwd(dir).quiet();
    await $`git tag vendor-snapshot`.cwd(dir).quiet();
    await commit("docs: say why");
    expect(await report()).toEqual({
      exitCode: 1,
      text: "release-report: 1 unreleased change(s) since v0.1.0:\n  fix(parts): keep the order of parts (#3)\n",
    });
  },
  { timeout: 30_000 },
);

test(
  "with no tag yet, every conventional commit in the history is unreleased",
  async () => {
    await initRepo();
    await commit("docs: say why");
    expect(await report()).toEqual({ exitCode: 0, text: "release-report: no unreleased changes with no tag yet\n" });

    await commit("feat: price a bill (#4)");
    expect(await report()).toEqual({
      exitCode: 1,
      text: "release-report: 1 unreleased change(s) with no tag yet:\n  feat: price a bill (#4)\n",
    });
  },
  { timeout: 30_000 },
);

test(
  "release notes write the section of the exact version to the output path",
  async () => {
    await initRepo();
    const changelog = ["# Changelog", "", "## 0.2.0", "", "Released 2026-09-27.", "", "### Features", "", "- Price a bill", "", "## 0.1.0", "", "older"].join("\n");
    await writeFile(join(dir, "CHANGELOG.md"), changelog);
    await commit("chore: add a changelog");

    const output = join(dir, "notes.md");
    expect(await notes("0.2.0", output)).toEqual({ exitCode: 0, text: "" });
    expect(await readFile(output, "utf8")).toBe("Released 2026-09-27.\n\n### Features\n\n- Price a bill");

    const usage = await notes("0.2.0");
    expect(usage.exitCode).toBe(2);
    expect(usage.text).toContain("usage: release-notes.ts <version> <output>");

    const prefixed = await notes("v0.2.0", output);
    expect(prefixed.exitCode).toBe(2);
    expect(prefixed.text).toContain("checks-release-notes: CHANGELOG.md has no section for v0.2.0");

    const missing = await notes("0.3.0", output);
    expect(missing.exitCode).toBe(2);
    expect(missing.text).toContain("checks-release-notes: CHANGELOG.md has no section for 0.3.0");
  },
  { timeout: 30_000 },
);
