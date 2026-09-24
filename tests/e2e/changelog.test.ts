import { $ } from "bun";
import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const SCRIPT = resolve(import.meta.dir, "..", "..", "scripts", "changelog-write.ts");
const DATED = { GIT_AUTHOR_DATE: "2026-09-01T12:00:00+00:00", GIT_COMMITTER_DATE: "2026-09-01T12:00:00+00:00" };
// bun test pins its own zone to UTC, so the writer and the expected date both take this one instead.
const ZONE = "Pacific/Kiritimati";

let dir = "";

afterEach(async () => {
  if (dir !== "") {
    await rm(dir, { recursive: true, force: true });
    dir = "";
  }
});

async function initRepo(): Promise<void> {
  dir = await mkdtemp(join(tmpdir(), "checks-changelog-"));
  await $`git init -q -b main`.cwd(dir).quiet();
  await $`git config user.name tester && git config user.email tester@example.com`.cwd(dir).quiet();
}

async function bump(version: string): Promise<void> {
  await writeFile(join(dir, "package.json"), JSON.stringify({ name: "widget", version }, null, 2));
}

async function commit(message: string): Promise<void> {
  await $`git add -A && git commit -q --no-gpg-sign --allow-empty -m ${message}`.cwd(dir).env({ ...process.env, ...DATED }).quiet();
}

async function changelog(cwd = dir): Promise<{ exitCode: number; text: string }> {
  const result = await $`bun ${SCRIPT}`.cwd(cwd).env({ ...process.env, TZ: ZONE }).nothrow().quiet();
  return { exitCode: result.exitCode, text: result.stdout.toString() + result.stderr.toString() };
}

async function rewritten(): Promise<string> {
  expect(await changelog()).toEqual({ exitCode: 0, text: "changelog: wrote 2 release(s) to CHANGELOG.md\n" });
  return readFile(join(dir, "CHANGELOG.md"), "utf8");
}

function localDate(): string {
  return new Date().toLocaleDateString("sv-SE", { timeZone: ZONE });
}

function written(pending: string): string {
  return [
    "# Changelog",
    "",
    "Every release of `widget`, newest first, written by the release from its conventional commits.",
    "",
    "## 0.3.0",
    "",
    `Released ${pending}.`,
    "",
    "### Features",
    "",
    "- price a bill (#4)",
    "",
    "### Fixes",
    "",
    "- **parts:** keep the order of parts (#2)",
    "",
    "## 0.1.0",
    "",
    "Released 2026-09-01.",
    "",
    "### Features",
    "",
    "- build a bill (#1)",
    "",
  ].join("\n");
}

test(
  "a release commit carries its section from the bump on, and later commits and its tag leave the changelog alone",
  async () => {
    await initRepo();
    await bump("0.1.0");
    await commit("feat: build a bill (#1)");
    await $`git tag v0.1.0`.cwd(dir).quiet();
    await commit("fix(parts): keep the order of parts (#2)");
    await bump("0.2.0");
    await commit("chore: release 0.2.0, never tagged (#3)");
    await commit("feat: price a bill (#4)");

    await bump("0.3.0");
    const before = localDate();
    const bumped = await rewritten();
    const pending = /^Released (\S+)\.$/m.exec(bumped)?.[1] ?? "";
    expect([before, localDate()]).toContain(pending);
    expect(bumped).toBe(written(pending));

    await commit("chore: release 0.3.0 (#5)");
    expect(await rewritten()).toBe(written(pending));
    await commit("feat: after the release (#6)");
    expect(await rewritten()).toBe(written(pending));
    await $`git tag -a -m release v0.3.0 HEAD~1`.cwd(dir).quiet();
    expect(await rewritten()).toBe(written(pending));
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
