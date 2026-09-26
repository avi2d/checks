import { $ } from "bun";
import { expect, test } from "bun:test";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { CHECKOUT, fixtureRepos, ran, type Ran } from "./lib/fixture-repo.ts";

const SCRIPT = join(CHECKOUT, "scripts", "changelog-write.ts");
const DATED = { GIT_AUTHOR_DATE: "2026-09-01T12:00:00+00:00", GIT_COMMITTER_DATE: "2026-09-01T12:00:00+00:00" };
// bun test pins its own zone to UTC, so the writer and the expected date both take this one instead.
const ZONE = "Pacific/Kiritimati";
const repository = fixtureRepos("checks-changelog-");

let dir = "";

async function initRepo(): Promise<void> {
  ({ dir } = await repository());
  // A merge or a revert commits outside commit(), so the repository carries an identity of its own.
  await $`git config user.name tester && git config user.email tester@example.com`.cwd(dir).quiet();
}

async function bump(version: string): Promise<void> {
  await writeFile(
    join(dir, "package.json"),
    JSON.stringify({ name: "widget", version, repository: { type: "git", url: "git+https://github.com/acme/widget.git" } }, null, 2),
  );
}

async function commit(message: string): Promise<void> {
  await $`git add -A && git commit -q --no-gpg-sign --allow-empty -m ${message}`.cwd(dir).env({ ...process.env, ...DATED }).quiet();
}

function changelog(cwd = dir): Promise<Ran> {
  return ran($`bun ${SCRIPT}`.cwd(cwd).env({ ...process.env, TZ: ZONE }));
}

async function rewritten(releases: number, cwd = dir): Promise<string> {
  expect(await changelog(cwd)).toEqual({ exitCode: 0, text: `changelog: wrote ${releases} release(s) to CHANGELOG.md\n` });
  return readFile(join(cwd, "CHANGELOG.md"), "utf8");
}

function localDate(): string {
  return new Date().toLocaleDateString("sv-SE", { timeZone: ZONE });
}

function section(version: string, date: string, ...groups: readonly (readonly [string, ...string[]])[]): readonly string[] {
  return [`## ${version}`, "", `Released ${date}.`, "", ...groups.flatMap(([group, ...entries]) => [`### ${group}`, "", ...entries.map((entry) => `- ${entry}`), ""])];
}

function written(...sections: readonly (readonly string[])[]): string {
  return ["# Changelog", "", "Every release of `widget`, newest first, written by the release from its conventional commits.", "", ...sections.flat()].join("\n");
}

test(
  "with no tag in the checkout, the bump closes its release, the release commit keeps its section and later commits wait",
  async () => {
    await initRepo();
    await bump("0.1.0");
    await commit("feat: build a bill (#1)");
    await commit("fix(parts): keep the order of parts (#2)");

    await bump("0.2.0");
    const before = localDate();
    const bumped = await rewritten(2);
    const pending = /^Released (\S+)\.$/m.exec(bumped)?.[1] ?? "";
    expect([before, localDate()]).toContain(pending);
    const expected = written(
      section("0.2.0", pending, ["Fixes", "**parts:** keep the order of parts [#2](https://github.com/acme/widget/pull/2)"]),
      section("0.1.0", "2026-09-01", ["Features", "build a bill [#1](https://github.com/acme/widget/pull/1)"]),
    );
    expect(bumped).toBe(expected);

    await commit("chore: release 0.2.0 (#3)");
    expect(await rewritten(2)).toBe(expected);
    await commit("feat: after the release (#4)");
    expect(await rewritten(2)).toBe(expected);
  },
  { timeout: 30_000 },
);

test(
  "a clone without the tags writes the changelog the tagged checkout writes",
  async () => {
    await initRepo();
    await bump("0.1.0");
    await commit("feat: build a bill (#1)");
    await $`git tag v0.1.0`.cwd(dir).quiet();
    await commit("fix: keep the order of parts (#2)");
    await bump("0.2.0");
    await rewritten(2);
    await commit("chore: release 0.2.0 (#3)");
    await $`git tag v0.2.0`.cwd(dir).quiet();
    const tagged = await rewritten(2);
    const clone = `${dir}-untagged`;
    await $`git clone -q --no-tags file://${dir} ${clone}`.quiet();
    try {
      expect((await $`git tag -l`.cwd(clone).quiet()).stdout.toString()).toBe("");
      expect(await rewritten(2, clone)).toBe(tagged);
    } finally {
      await rm(clone, { recursive: true, force: true });
    }
  },
  { timeout: 30_000 },
);

test(
  "a branch that merged main in after main gained a release keeps main's changelog",
  async () => {
    await initRepo();
    await bump("0.1.0");
    await commit("feat: build a bill (#1)");
    await $`git switch -q -c topic`.cwd(dir).quiet();
    await commit("feat: on the topic (#2)");
    await $`git switch -q main`.cwd(dir).quiet();
    await commit("fix: keep the order of parts (#3)");
    await bump("0.2.0");
    await rewritten(2);
    await commit("chore: release 0.2.0 (#4)");
    const main = await readFile(join(dir, "CHANGELOG.md"), "utf8");

    await $`git switch -q topic && git merge -q --no-edit --no-gpg-sign main`.cwd(dir).env({ ...process.env, ...DATED }).quiet();
    expect(await rewritten(2)).toBe(main);
  },
  { timeout: 30_000 },
);

test(
  "a bumped version an existing changelog leaves out was never released, and its commits roll into the next",
  async () => {
    await initRepo();
    await bump("0.1.0");
    await commit("feat: build a bill (#1)");
    await bump("0.2.0");
    await commit("chore: bump 0.2.0 (#2)");
    await commit("fix(parts): keep the order of parts (#3)");
    await bump("0.3.0");
    await commit("feat: price a bill (#4)");
    await writeFile(join(dir, "CHANGELOG.md"), written(section("0.3.0", "2026-09-10"), section("0.1.0", "2026-09-05")));

    expect(await rewritten(2)).toBe(
      written(
        section("0.3.0", "2026-09-10", ["Features", "price a bill [#4](https://github.com/acme/widget/pull/4)"], ["Fixes", "**parts:** keep the order of parts [#3](https://github.com/acme/widget/pull/3)"]),
        section("0.1.0", "2026-09-05", ["Features", "build a bill [#1](https://github.com/acme/widget/pull/1)"]),
      ),
    );
  },
  { timeout: 30_000 },
);

test(
  "a release reverted before its tag leaves the changelog, and the next bump releases its commits",
  async () => {
    await initRepo();
    await bump("0.1.0");
    await commit("feat: build a bill (#1)");
    await bump("0.2.0");
    await rewritten(2);
    await commit("chore: release 0.2.0 (#2)");
    const released = await readFile(join(dir, "CHANGELOG.md"), "utf8");
    await commit("feat: price a bill (#3)");
    await bump("0.3.0");
    await rewritten(3);
    await commit("chore: release 0.3.0 (#4)");

    await $`git revert --no-edit --no-gpg-sign HEAD`.cwd(dir).env({ ...process.env, ...DATED }).quiet();
    expect(await rewritten(2)).toBe(released);

    await commit("fix(parts): keep the order of parts (#5)");
    await bump("0.3.0");
    const rebumped = await rewritten(3);
    const pending = /^Released (\S+)\.$/m.exec(rebumped)?.[1] ?? "";
    expect(rebumped).toBe(
      written(
        section("0.3.0", pending, ["Features", "price a bill [#3](https://github.com/acme/widget/pull/3)"], ["Fixes", "**parts:** keep the order of parts [#5](https://github.com/acme/widget/pull/5)"]),
        section("0.2.0", /^Released (\S+)\.$/m.exec(released)?.[1] ?? ""),
        section("0.1.0", "2026-09-01", ["Features", "build a bill [#1](https://github.com/acme/widget/pull/1)"]),
      ),
    );
  },
  { timeout: 30_000 },
);

test(
  "a shallow checkout is refused rather than written from the part of the history it holds",
  async () => {
    await initRepo();
    await bump("0.1.0");
    await commit("feat: build a bill (#1)");
    await commit("fix: keep the order of parts (#2)");
    const shallow = `${dir}-shallow`;
    await $`git clone -q --depth 1 file://${dir} ${shallow}`.quiet();
    try {
      const refused = await changelog(shallow);
      expect(refused.exitCode).toBe(2);
      expect(refused.text).toContain("changelog: the checkout is shallow");
    } finally {
      await rm(shallow, { recursive: true, force: true });
    }
  },
  { timeout: 30_000 },
);
